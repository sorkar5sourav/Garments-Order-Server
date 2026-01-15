const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const compression = require("compression");
const app = express();
require("dotenv").config();
const crypto = require("crypto");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const stripe = require("stripe")(process.env.STRIPE_SECRET);

const port = process.env.PORT || 3000;
var admin = require("firebase-admin");

// Load Firebase service account from environment
let serviceAccount;
try {
  const decoded = Buffer.from(process.env.FB_SERVICE_KEY, "base64").toString(
    "utf8"
  );
  serviceAccount = JSON.parse(decoded);
} catch (err) {}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// Basic security and performance middlewares
app.use(express.json());
app.use(helmet());
app.use(cors());
app.use(compression());

// If running behind a proxy (like Heroku / Cloudflare), enable trust proxy
if (process.env.TRUST_PROXY === "1" || process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}

// Rate limiting to mitigate abuse
const RATE_LIMIT_WINDOW_MS =
  Number(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000; // default 15 minutes
const RATE_LIMIT_MAX =
  Number(process.env.RATE_LIMIT_MAX) ||
  (process.env.NODE_ENV === "production" ? 100 : 2000);
// Optional comma-separated list of IPs to whitelist from rate limiting
const RATE_LIMIT_WHITELIST = (process.env.RATE_LIMIT_WHITELIST || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const limiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  // Skip limiting for trusted IPs or important endpoints (adjust the paths as needed)
  skip: (req) => {
    if (RATE_LIMIT_WHITELIST.includes(req.ip)) return true;
    const safePaths = ["/payment-success", "/payment-checkout-session", "/"];
    if (safePaths.some((p) => req.path.startsWith(p))) return true;
    return false;
  },
  handler: (req, res) => {
    res.status(429).json({ message: "Too many requests - try again later" });
  },
});

app.use(limiter);

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.jskgf2c.mongodb.net/?appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});
// Track initialization state for serverless environments
let isInitialized = false;
let initPromise = null;

const verifyFBToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res
      .status(401)
      .send({ message: "unauthorized access - no token provided" });
  }

  // Check if token is in Bearer format
  if (!authHeader.startsWith("Bearer ")) {
    return res
      .status(401)
      .send({ message: "unauthorized access - invalid token format" });
  }

  try {
    const idToken = authHeader.split(" ")[1];

    if (!idToken) {
      return res
        .status(401)
        .send({ message: "unauthorized access - token missing" });
    }

    const decoded = await admin.auth().verifyIdToken(idToken);
    // console.log("decoded in the token", decoded);
    req.decoded_email = decoded.email;
    next();
  } catch (err) {
    // console.error("Token verification error:", err.message);
    return res
      .status(401)
      .send({ message: "unauthorized access - invalid or expired token" });
  }
};
// Helper to validate incoming id params before attempting ObjectId conversion
const isValidObjectId = (id) => {
  try {
    return ObjectId.isValid(id);
  } catch (e) {
    return false;
  }
};
async function run() {
  // Prevent multiple simultaneous initializations
  if (isInitialized) {
    return;
  }
  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    try {
      // Connect the client to the server
      await client.connect();
      const db = client.db("Garments-Order-Production-Tracker-db");
      const userCollection = db.collection("users");
      const productCollection = db.collection("products");
      const orderCollection = db.collection("orders");
      const paymentCollection = db.collection("payments");
      const reviewCollection = db.collection("reviews");
      const faqCollection = db.collection("faqs");
      const blogCollection = db.collection("blogs");

      // --- Reusable helpers to reduce repeated code ---
      const sendNoUser = (res) =>
        res.status(403).send({ message: "User not found", code: "NO_USER" });
      const sendPending = (res) =>
        res.status(401).send({
          message: "Account pending approval. Please wait for activation.",
          code: "PENDING",
        });
      const sendSuspended = (res, actor) =>
        res.status(403).send({
          message: "Account suspended. Cannot perform this action.",
          code: "SUSPENDED",
          suspendReason: actor?.suspendReason || null,
          suspendFeedback: actor?.suspendFeedback || null,
        });

      const fetchActor = async (email) => {
        if (!email) return null;
        return await userCollection.findOne({ email });
      };

      // Ensure actor exists, is active (unless admin) and not suspended. Returns actor or sends a response and returns null.
      const requireActor = async (req, res) => {
        const actor = await fetchActor(req.decoded_email);
        if (!actor) {
          sendNoUser(res);
          return null;
        }
        if (actor.status !== "active" && actor.role !== "admin") {
          sendPending(res);
          return null;
        }
        if (actor.status === "suspended") {
          sendSuspended(res, actor);
          return null;
        }
        return actor;
      };

      // Ensure actor has at least one of the allowed roles. Sends 403 if not.
      const requireRoles = (
        actor,
        res,
        allowedRoles,
        message = "Forbidden"
      ) => {
        if (!allowedRoles.includes(actor.role)) {
          res.status(403).send({ message, code: "FORBIDDEN" });
          return false;
        }
        return true;
      };

      // Simple helper to enforce that an email belongs to the requester
      const ensureEmailMatchesRequester = (
        req,
        res,
        email,
        errorMsg = "You can only view your own orders"
      ) => {
        if (!email || email.toLowerCase() !== req.decoded_email.toLowerCase()) {
          res.status(403).send({ message: errorMsg, code: "FORBIDDEN" });
          return false;
        }
        return true;
      };

      // Ensure a unique index on email to prevent duplicates at the DB level
      try {
        await userCollection.createIndex(
          { email: 1 },
          {
            unique: true,
            partialFilterExpression: { email: { $exists: true } },
          }
        );
      } catch (idxErr) {
        // Ignore index creation errors in case the index already exists or on restricted environments
        // console.warn('Index creation warning:', idxErr.message);
      }

      // users related apis
      app.post("/users", async (req, res) => {
        const user = req.body;
        if (!user || !user.email) {
          return res.status(400).send({ message: "Email is required" });
        }

        // Normalize email to avoid case-variants creating duplicates
        user.email = String(user.email).toLowerCase();

        // Set defaults if not provided
        user.role = user.role || "buyer";
        user.status = user.status || "pending";
        user.suspendReason = null;
        user.suspendFeedback = null;
        user.suspendedAt = null;
        user.createdAt = new Date();

        try {
          // Use upsert to make creation idempotent and avoid race-condition duplicates
          const result = await userCollection.updateOne(
            { email: user.email },
            { $setOnInsert: user },
            { upsert: true }
          );

          // If a new document was inserted, upsertedCount will be 1
          if (result.upsertedCount && result.upsertedCount > 0) {
            return res.status(201).send({
              message: "user created",
              userId: result.upsertedId ? result.upsertedId._id : null,
            });
          }

          // Otherwise the user already existed
          return res.status(200).send({ message: "user exists" });
        } catch (err) {
          // Handle duplicate key errors just in case
          if (err && err.code === 11000) {
            return res.status(409).send({ message: "user exists" });
          }
          res
            .status(500)
            .send({ message: "Error creating user", error: err.message });
        }
      });

      app.get("/users/:email/role", async (req, res) => {
        const email = req.params.email;
        const query = { email };
        const user = await userCollection.findOne(query);
        res.send({
          role: user?.role || "user",
          status: user?.status || "active",
          suspendReason: user?.suspendReason || null,
          suspendFeedback: user?.suspendFeedback || null,
        });
      });

      // admin - get all users
      app.get("/users", async (req, res) => {
        try {
          const { search, role, status } = req.query;
          const query = {};

          if (search) {
            const regex = new RegExp(search, "i");
            query.$or = [
              { displayName: regex },
              { name: regex },
              { email: regex },
            ];
          }

          if (role && role !== "all") {
            query.role = role;
          }

          if (status && status !== "all") {
            query.status = status;
          }

          const users = await userCollection
            .find(query)
            .sort({ createdAt: -1 })
            .toArray();
          res.send(users);
        } catch (error) {
          res
            .status(500)
            .send({ message: "Error fetching users", error: error.message });
        }
      });

      // admin - update user role / status
      app.patch("/users/:id/role", async (req, res) => {
        try {
          const id = req.params.id;
          if (!isValidObjectId(id)) {
            return res.status(400).send({ message: "Invalid user id" });
          }
          const { role, status, suspendReason, suspendFeedback, suspendedAt } =
            req.body;

          const updateDoc = { $set: { updatedAt: new Date() } };
          if (role) updateDoc.$set.role = role;
          if (status) updateDoc.$set.status = status;
          if (typeof suspendReason !== "undefined" || status === "active") {
            updateDoc.$set.suspendReason = suspendReason || null;
          }
          if (typeof suspendFeedback !== "undefined" || status === "active") {
            updateDoc.$set.suspendFeedback = suspendFeedback || null;
          }
          if (typeof suspendedAt !== "undefined" || status === "active") {
            updateDoc.$set.suspendedAt = suspendedAt || null;
          }

          const result = await userCollection.updateOne(
            { _id: new ObjectId(id) },
            updateDoc
          );
          res.send(result);
        } catch (error) {
          res
            .status(500)
            .send({ message: "Error updating user", error: error.message });
        }
      });

      // Get all products
      app.get("/products", async (req, res) => {
        try {
          const {
            createdBy,
            page = 1,
            limit = 12,
            search = "",
            category,
            minPrice,
            maxPrice,
            sortBy,
            order,
          } = req.query;
          const query = {};
          if (createdBy) query.createdBy = createdBy;
          if (category) query.category = category;
          const priceFilter = {};
          if (minPrice) priceFilter.$gte = Number(minPrice);
          if (maxPrice) priceFilter.$lte = Number(maxPrice);
          if (Object.keys(priceFilter).length) {
            query.price = priceFilter;
          }

          // Add search functionality
          if (search) {
            query.$or = [
              { name: { $regex: search, $options: "i" } },
              { description: { $regex: search, $options: "i" } },
              { category: { $regex: search, $options: "i" } },
              { brand: { $regex: search, $options: "i" } },
            ];
          }

          const pageNum = parseInt(page);
          const limitNum = parseInt(limit);
          const skip = (pageNum - 1) * limitNum;

          const totalProducts = await productCollection.countDocuments(query);

          // Sorting
          const sort = {};
          if (sortBy) {
            const direction = order === "asc" ? 1 : -1;
            if (["createdAt", "price", "availableQuantity"].includes(sortBy)) {
              sort[sortBy] = direction;
            }
          } else {
            sort.createdAt = -1;
          }

          const products = await productCollection
            .find(query)
            .sort(sort)
            .skip(skip)
            .limit(limitNum)
            .toArray();

          res.send({
            products,
            pagination: {
              currentPage: pageNum,
              limit: limitNum,
              totalProducts,
              totalPages: Math.ceil(totalProducts / limitNum),
            },
          });
        } catch (error) {
          res
            .status(500)
            .send({ message: "Error fetching products", error: error.message });
        }
      });

      // Product categories summary for homepage
      app.get("/products/categories-summary", async (req, res) => {
        try {
          const pipeline = [
            {
              $group: {
                _id: "$category",
                totalProducts: { $sum: 1 },
                totalAvailable: { $sum: "$availableQuantity" },
              },
            },
            {
              $project: {
                _id: 0,
                category: "$_id",
                totalProducts: 1,
                totalAvailable: 1,
              },
            },
            { $sort: { totalProducts: -1 } },
          ];

          const categories = await productCollection.aggregate(pipeline).toArray();
          res.send({ categories });
        } catch (error) {
          res.status(500).send({
            message: "Error fetching category summary",
            error: error.message,
          });
        }
      });

      // Post a new product
      app.post("/products", verifyFBToken, async (req, res) => {
        try {
          const actor = await requireActor(req, res);
          if (!actor) return;

          if (
            !requireRoles(
              actor,
              res,
              ["manager", "admin"],
              "Only managers or admins can add products"
            )
          )
            return;

          const product = req.body;
          product.createdAt = new Date();
          product.createdBy = req.decoded_email;

          const result = await productCollection.insertOne(product);
          res.send(result);
        } catch (error) {
          res
            .status(500)
            .send({ message: "Error adding product", error: error.message });
        }
      });

      // Update product (only manager or admin)
      app.patch("/products/:id", verifyFBToken, async (req, res) => {
        try {
          const id = req.params.id;
          if (!isValidObjectId(id))
            return res.status(400).send({ message: "Invalid product id" });

          const actor = await requireActor(req, res);
          if (!actor) return;
          if (
            !requireRoles(
              actor,
              res,
              ["manager", "admin"],
              "Only managers or admins can update products"
            )
          )
            return;

          const updates = req.body || {};
          updates.updatedAt = new Date();

          const result = await productCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: updates }
          );
          res.send(result);
        } catch (error) {
          res
            .status(500)
            .send({ message: "Error updating product", error: error.message });
        }
      });

      // Delete product (only manager or admin)
      app.delete("/products/:id", verifyFBToken, async (req, res) => {
        try {
          const id = req.params.id;
          if (!isValidObjectId(id))
            return res.status(400).send({ message: "Invalid product id" });

          const actor = await requireActor(req, res);
          if (!actor) return;
          if (
            !requireRoles(
              actor,
              res,
              ["manager", "admin"],
              "Only managers or admins can delete products"
            )
          )
            return;

          const result = await productCollection.deleteOne({
            _id: new ObjectId(id),
          });
          res.send(result);
        } catch (error) {
          res
            .status(500)
            .send({ message: "Error deleting product", error: error.message });
        }
      });

      // Post a new order (protected)
      app.post("/orders", verifyFBToken, async (req, res) => {
        try {
          const orderData = req.body;

          // Ensure requester matches the order email
          if (
            !ensureEmailMatchesRequester(
              req,
              res,
              orderData.email,
              "Cannot place orders for a different account."
            )
          )
            return;

          const actor = await requireActor(req, res);
          if (!actor) return;

          orderData.status = "pending"; // Admin approval status
          orderData.paymentStatus = "unpaid"; // Payment status - user can pay without approval
          orderData.createdAt = new Date();

          // If a productId and quantity are provided, attempt to decrement the product stock atomically
          const productId = orderData.productId;
          const qty = Math.max(0, Number(orderData.quantity) || 0);

          if (productId && isValidObjectId(productId) && qty > 0) {
            const decResult = await productCollection.updateOne(
              {
                _id: new ObjectId(productId),
                availableQuantity: { $gte: qty },
              },
              { $inc: { availableQuantity: -qty, sold: qty } }
            );

            if (!decResult.modifiedCount || decResult.modifiedCount === 0) {
              return res.status(400).send({
                message: "Insufficient product quantity",
                code: "OUT_OF_STOCK",
              });
            }

            try {
              const result = await orderCollection.insertOne(orderData);
              return res.status(201).send({
                message: "Order placed successfully",
                orderId: result.insertedId,
                result,
              });
            } catch (insertErr) {
              try {
                await productCollection.updateOne(
                  { _id: new ObjectId(productId) },
                  { $inc: { availableQuantity: qty, sold: -qty } }
                );
              } catch (rbErr) {}
              throw insertErr;
            }
          }

          const result = await orderCollection.insertOne(orderData);
          res.status(201).send({
            message: "Order placed successfully",
            orderId: result.insertedId,
            result,
          });
        } catch (error) {
          res
            .status(500)
            .send({ message: "Error placing order", error: error.message });
        }
      });

      // payment related apis
      app.post("/payment-checkout-session", verifyFBToken, async (req, res) => {
        try {
          const parcelInfo = req.body || {};

          const costValue =
            parcelInfo.cost ?? parcelInfo.totalPrice ?? parcelInfo.amount;
          const senderEmail = parcelInfo.senderEmail || parcelInfo.email;
          if (!costValue || !senderEmail)
            return res
              .status(400)
              .send({ error: "Missing required fields: cost and senderEmail" });

          const amount = Math.round(Number(costValue) * 0.82);
          if (isNaN(amount) || amount <= 0)
            return res.status(400).send({ error: "Invalid cost value" });

          const actor = await requireActor(req, res);
          if (!actor) return;

          // Get the origin from the request to redirect back to the same domain
          const getOrigin = () => {
            // Try origin header first (set by browser for CORS requests)
            if (req.headers.origin) {
              return req.headers.origin;
            }
            // Try referer header and extract origin
            if (req.headers.referer) {
              try {
                const refererUrl = new URL(req.headers.referer);
                return refererUrl.origin;
              } catch (e) {
                // Invalid URL, continue to next option
              }
            }
            // Construct from request protocol and host
            const protocol = req.protocol || (req.secure ? "https" : "http");
            const host = req.get("host");
            if (host) {
              return `${protocol}://${host}`;
            }
            // Fallback to environment variables or localhost
            return (
              process.env.SITE_DOMAIN ||
              process.env.FRONTEND_URL ||
              "http://localhost:5173"
            );
          };

          const baseUrl = getOrigin();

          const session = await stripe.checkout.sessions.create({
            line_items: [
              {
                price_data: {
                  currency: "usd",
                  unit_amount: amount,
                  product_data: {
                    name: `Please pay for: ${
                      parcelInfo.parcelName ||
                      parcelInfo.productTitle ||
                      "Order"
                    }`,
                  },
                },
                quantity: 1,
              },
            ],
            mode: "payment",
            metadata: { orderId: parcelInfo.parcelId },
            customer_email: senderEmail,
            success_url: `${baseUrl}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${baseUrl}/dashboard/payment-cancelled`,
          });

          res.send({ url: session.url, id: session.id });
        } catch (err) {
          res.status(500).send({
            error: "Server error creating checkout session",
            detail: err.message,
          });
        }
      });

      // Update order payment status after successful payment (protected)
      app.patch(
        "/orders/:id/payment-status",
        verifyFBToken,
        async (req, res) => {
          try {
            const id = req.params.id;
            if (!isValidObjectId(id))
              return res.status(400).send({ message: "Invalid order id" });

            const actor = await requireActor(req, res);
            if (!actor) return;

            const { paymentStatus, transactionId } = req.body;
            const result = await orderCollection.updateOne(
              { _id: new ObjectId(id) },
              {
                $set: {
                  paymentStatus,
                  transactionId,
                  paidAt: new Date(),
                  updatedAt: new Date(),
                },
              }
            );
            res.send(result);
          } catch (error) {
            res.status(500).send({
              message: "Error updating payment status",
              error: error.message,
            });
          }
        }
      );

      // Handle payment success - update order status
      app.patch("/payment-success", async (req, res) => {
        try {
          const sessionId = req.query.session_id;

          if (!sessionId) {
            return res.status(400).send({ error: "Missing session_id" });
          }

          const session = await stripe.checkout.sessions.retrieve(sessionId);
          const transactionId = session.payment_intent;

          // Check if payment already processed
          const paymentExist = await paymentCollection.findOne({
            transactionId,
          });
          if (paymentExist) {
            return res.send({
              success: true,
              message: "Payment already processed",
              transactionId,
              orderId: paymentExist.orderId,
            });
          }

          if (session.payment_status === "paid") {
            const orderId = session.metadata.orderId;

            // Update order payment status
            const updateResult = await orderCollection.updateOne(
              { _id: new ObjectId(orderId) },
              {
                $set: {
                  paymentStatus: "paid",
                  transactionId: transactionId,
                  paidAt: new Date(),
                  updatedAt: new Date(),
                },
              }
            );

            // Record payment
            const payment = {
              orderId: orderId,
              amount: session.amount_total / 100,
              currency: session.currency,
              customerEmail: session.customer_email,
              transactionId: transactionId,
              paymentStatus: session.payment_status,
              paidAt: new Date(),
            };

            const paymentResult = await paymentCollection.insertOne(payment);

            return res.send({
              success: true,
              message: "Payment processed successfully",
              orderId: orderId,
              transactionId: transactionId,
              paymentId: paymentResult.insertedId,
            });
          }

          return res
            .status(400)
            .send({ success: false, message: "Payment not completed" });
        } catch (error) {
          // console.error("Error in /payment-success:", error);
          res.status(500).send({
            error: "Server error processing payment",
            detail: error.message,
          });
        }
      });

      // Get orders by email (protected - legacy endpoint)
      // Allow if requester is manager/admin or the email matches the requester
      app.get("/orders/:email", verifyFBToken, async (req, res) => {
        try {
          const email = req.params.email;
          const actor = await requireActor(req, res);
          if (!actor) return;

          if (
            !(
              ["manager", "admin"].includes(actor.role) ||
              email.toLowerCase() === req.decoded_email.toLowerCase()
            )
          ) {
            return res.status(403).send({
              message: "You can only view your own orders",
              code: "FORBIDDEN",
            });
          }
          const orders = await orderCollection.find({ email }).toArray();
          res.send(orders);
        } catch (error) {
          res
            .status(500)
            .send({ message: "Error fetching orders", error: error.message });
        }
      });

      // Get order by id
      app.get("/orders/id/:id", async (req, res) => {
        try {
          const id = req.params.id;
          if (!isValidObjectId(id)) {
            return res.status(400).send({ message: "Invalid order id" });
          }
          const order = await orderCollection.findOne({
            _id: new ObjectId(id),
          });
          res.send(order || {});
        } catch (error) {
          res.status(500).send({
            message: "Error fetching order",
            error: error.message,
          });
        }
      });

      // Delete an order (protected)
      app.delete("/orders/:id", verifyFBToken, async (req, res) => {
        try {
          const id = req.params.id;
          if (!isValidObjectId(id))
            return res.status(400).send({ message: "Invalid order id" });

          const actor = await requireActor(req, res);
          if (!actor) return;

          const result = await orderCollection.deleteOne({
            _id: new ObjectId(id),
          });
          res.send(result);
        } catch (error) {
          res
            .status(500)
            .send({ message: "Error deleting order", error: error.message });
        }
      });

      // Get orders (protected)
      // - Managers/Admins: can view all orders (with optional filters)
      // - Regular users: can only view their own orders by passing ?email=<their email>
      app.get("/orders", verifyFBToken, async (req, res) => {
        try {
          const actor = await requireActor(req, res);
          if (!actor) return;

          const { email, status } = req.query;
          const query = {};

          if (["manager", "admin"].includes(actor.role)) {
            if (email) query.email = email;
            if (status) query.status = status;
          } else {
            if (!email)
              return res.status(403).send({
                message:
                  "Regular users must provide their email to view orders",
                code: "FORBIDDEN",
              });
            if (email.toLowerCase() !== req.decoded_email.toLowerCase())
              return res.status(403).send({
                message: "You can only view your own orders",
                code: "FORBIDDEN",
              });
            query.email = req.decoded_email;
            if (status) query.status = status;
          }

          const orders = await orderCollection.find(query).toArray();
          res.send(orders);
        } catch (error) {
          res
            .status(500)
            .send({ message: "Error fetching orders", error: error.message });
        }
      });
      // Generic update order endpoint (protected) - only manager or admin
      app.patch("/orders/:id", verifyFBToken, async (req, res) => {
        try {
          const id = req.params.id;
          if (!isValidObjectId(id))
            return res.status(400).send({ message: "Invalid order id" });

          const actor = await requireActor(req, res);
          if (!actor) return;
          if (
            !requireRoles(
              actor,
              res,
              ["manager", "admin"],
              "Only managers or admins can update orders"
            )
          )
            return;

          const updateData = req.body;
          const result = await orderCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: { ...updateData, updatedAt: new Date() } }
          );
          res.send(result);
        } catch (error) {
          res
            .status(500)
            .send({ message: "Error updating order", error: error.message });
        }
      });

      // Update order status
      app.patch("/orders/:id/status", verifyFBToken, async (req, res) => {
        try {
          const id = req.params.id;
          if (!isValidObjectId(id))
            return res.status(400).send({ message: "Invalid order id" });
          const { status, approvedAt } = req.body;

          const actor = await requireActor(req, res);
          if (!actor) return;
          if (
            !requireRoles(
              actor,
              res,
              ["manager", "admin"],
              "Only managers or admins can update order status"
            )
          )
            return;

          const result = await orderCollection.updateOne(
            { _id: new ObjectId(id) },
            {
              $set: {
                status,
                updatedAt: new Date(),
                ...(approvedAt ? { approvedAt: new Date(approvedAt) } : {}),
              },
            }
          );
          res.send(result);
        } catch (error) {
          res.status(500).send({
            message: "Error updating order status",
            error: error.message,
          });
        }
      });

      // Add tracking update to an order (protected) - only manager or admin
      app.patch("/orders/:id/tracking", verifyFBToken, async (req, res) => {
        try {
          const id = req.params.id;
          if (!isValidObjectId(id))
            return res.status(400).send({ message: "Invalid order id" });

          const actor = await requireActor(req, res);
          if (!actor) return;
          if (
            !requireRoles(
              actor,
              res,
              ["manager", "admin"],
              "Only managers or admins can add tracking"
            )
          )
            return;

          const update = req.body || {};
          const trackingEntry = {
            status: update.status || "",
            location: update.location || "",
            note: update.note || "",
            time: update.time
              ? new Date(update.time).toISOString()
              : new Date().toISOString(),
            createdBy: req.decoded_email,
          };

          const result = await orderCollection.findOneAndUpdate(
            { _id: new ObjectId(id) },
            {
              $push: { trackingUpdates: trackingEntry },
              $set: { updatedAt: new Date() },
            },
            { returnDocument: "after" }
          );

          if (!result.value)
            return res.status(404).send({ message: "Order not found" });

          res.send({ message: "Tracking update added", order: result.value });
        } catch (error) {
          res.status(500).send({
            message: "Error adding tracking update",
            error: error.message,
          });
        }
      });

      // Reviews related APIs
      app.post("/reviews", async (req, res) => {
        try {
          const review = req.body;
          review.createdAt = new Date();
          review.status = "pending"; // Admin approval for display

          const result = await reviewCollection.insertOne(review);
          res.status(201).send({
            message: "Review submitted successfully",
            reviewId: result.insertedId,
            result,
          });
        } catch (error) {
          res.status(500).send({
            message: "Error submitting review",
            error: error.message,
          });
        }
      });

      app.get("/reviews", async (req, res) => {
        try {
          const { status = "approved" } = req.query;
          const query = {};
          if (status !== "all") {
            query.status = status;
          }

          const reviews = await reviewCollection
            .find(query)
            .sort({ createdAt: -1 })
            .limit(15)
            .toArray();

          res.send({ reviews });
        } catch (error) {
          res.status(500).send({
            message: "Error fetching reviews",
            error: error.message,
          });
        }
      });

      // Admin - update review status
      app.patch("/reviews/:id/status", verifyFBToken, async (req, res) => {
        try {
          const id = req.params.id;
          if (!isValidObjectId(id))
            return res.status(400).send({ message: "Invalid review id" });

          const actor = await requireActor(req, res);
          if (!actor) return;
          if (
            !requireRoles(
              actor,
              res,
              ["manager", "admin"],
              "Only managers or admins can update review status"
            )
          )
            return;

          const { status } = req.body;
          const result = await reviewCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: { status, updatedAt: new Date() } }
          );
          res.send(result);
        } catch (error) {
          res.status(500).send({
            message: "Error updating review status",
            error: error.message,
          });
        }
      });

      // FAQs (public)
      app.get("/faqs", async (req, res) => {
        try {
          const faqs = await faqCollection
            .find({ isActive: { $ne: false } })
            .sort({ order: 1, createdAt: -1 })
            .toArray();
          res.send({ faqs });
        } catch (error) {
          res
            .status(500)
            .send({ message: "Error fetching FAQs", error: error.message });
        }
      });

      // Blog posts (public, homepage highlights)
      app.get("/blogs", async (req, res) => {
        try {
          const { limit = 3 } = req.query;
          const limitNum = parseInt(limit);
          const blogs = await blogCollection
            .find({ isPublished: { $ne: false } })
            .sort({ publishedAt: -1, createdAt: -1 })
            .limit(limitNum)
            .toArray();
          res.send({ blogs });
        } catch (error) {
          res
            .status(500)
            .send({ message: "Error fetching blogs", error: error.message });
        }
      });

      // High-level stats for homepage and dashboards
      app.get("/home-stats", async (req, res) => {
        try {
          const [usersCount, productsCount, ordersCount, reviewsCount, completedOrders] =
            await Promise.all([
              userCollection.countDocuments(),
              productCollection.countDocuments(),
              orderCollection.countDocuments(),
              reviewCollection.countDocuments({ status: "approved" }),
              orderCollection.countDocuments({ status: "delivered" }),
            ]);

          res.send({
            usersCount,
            productsCount,
            ordersCount,
            reviewsCount,
            completedOrders,
          });
        } catch (error) {
          res.status(500).send({
            message: "Error fetching stats",
            error: error.message,
          });
        }
      });

      // Send a ping to confirm a successful connection
      // await client.db("admin").command({ ping: 1 });
      // console.log(
      //   "Pinged your deployment. You successfully connected to MongoDB!"
      // );
      isInitialized = true;
    } catch (error) {
      console.error("MongoDB Connection Error:", error);
      isInitialized = false;
      initPromise = null;
      throw error;
    } finally {
      // await client.close();
    }
  })();

  return initPromise;
}
run().catch((err) => {
  console.error("Failed to initialize server:", err);
});

if (require.main === module) {
  app.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });
}

app.get("/", (req, res) => {
  res.send("Server is running just fine!");
});

// Export the app for Vercel serverless deployment
module.exports = app;

// Centralized error handler (last middleware)
app.use((err, req, res, next) => {
  // console.error("Unhandled error:", err);
  if (res.headersSent) return next(err);
  res.status(500).send({ message: "Internal server error" });
});
