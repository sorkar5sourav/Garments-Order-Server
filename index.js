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
} catch (err) {
  // Fallback to local file if env var not available
  serviceAccount = require("./garments-order-tracker-firebase-adminsdk-fbsvc-7dec8bc60d.json");
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});


// Basic security and performance middlewares
app.use(express.json({ limit: '100kb' }));
app.use(helmet());
app.use(compression());

// CORS: restrict origin via env var when available
const allowedOrigin = process.env.FRONTEND_URL || process.env.SITE_DOMAIN || "http://localhost:5173";
app.use(
  cors({
    origin: allowedOrigin,
    credentials: true,
  })
);

// Rate limiting to mitigate abuse
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: Number(process.env.RATE_LIMIT_MAX) || 100, // limit each IP
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// If running behind a proxy (like Heroku / Cloudflare), enable trust proxy
if (process.env.TRUST_PROXY === "1" || process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.jskgf2c.mongodb.net/?appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});
const verifyFBToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).send({ message: "unauthorized access - no token provided" });
  }

  // Check if token is in Bearer format
  if (!authHeader.startsWith("Bearer ")) {
    return res.status(401).send({ message: "unauthorized access - invalid token format" });
  }

  try {
    const idToken = authHeader.split(" ")[1];
    
    if (!idToken) {
      return res.status(401).send({ message: "unauthorized access - token missing" });
    }

    const decoded = await admin.auth().verifyIdToken(idToken);
    console.log("decoded in the token", decoded);
    req.decoded_email = decoded.email;
    next();
  } catch (err) {
    console.error("Token verification error:", err.message);
    return res.status(401).send({ message: "unauthorized access - invalid or expired token" });
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
  try {
    // Connect the client to the server
    await client.connect();
    const db = client.db("Garments-Order-Production-Tracker-db");
    const userCollection = db.collection("users");
    const productCollection = db.collection("products");
    const orderCollection = db.collection("orders");
    const paymentCollection = db.collection("payments");
 

    // users related apis
    app.post("/users", async (req, res) => {
      const user = req.body;
      user.role = "user";
      user.status = "active";
      user.suspendReason = null;
      user.suspendFeedback = null;
      user.suspendedAt = null;
      user.createdAt = new Date();
      const email = user.email;
      const userExists = await userCollection.findOne({ email });

      if (userExists) {
        return res.send({ message: "user exists" });
      }

      const result = await userCollection.insertOne(user);
      res.send(result);
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
        const { createdBy, page = 1, limit = 12 } = req.query;
        const query = {};
        if (createdBy) query.createdBy = createdBy;

        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);
        const skip = (pageNum - 1) * limitNum;

        const totalProducts = await productCollection.countDocuments(query);
        const products = await productCollection
          .find(query)
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

    // Post a new product
    app.post("/products", verifyFBToken, async (req, res) => {
      try {
        const actorEmail = req.decoded_email;
        const actor = await userCollection.findOne({ email: actorEmail });

        if (!actor) {
          return res
            .status(403)
            .send({ message: "User not found", code: "NO_USER" });
        }

        if (!["manager", "admin"].includes(actor.role)) {
          return res.status(403).send({
            message: "Only managers or admins can add products",
            code: "FORBIDDEN",
          });
        }

        if (actor.status === "suspended") {
          return res.status(403).send({
            message: "Account suspended. Cannot add products.",
            code: "SUSPENDED",
            suspendReason: actor.suspendReason,
            suspendFeedback: actor.suspendFeedback,
          });
        }

        const product = req.body;
        product.createdAt = new Date();
        product.createdBy = actorEmail;

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
        if (!isValidObjectId(id)) {
          return res.status(400).send({ message: "Invalid product id" });
        }

        const actor = await userCollection.findOne({ email: req.decoded_email });
        if (!actor) {
          return res.status(403).send({ message: "User not found", code: "NO_USER" });
        }
        if (!["manager", "admin"].includes(actor.role)) {
          return res.status(403).send({ message: "Only managers or admins can update products", code: "FORBIDDEN" });
        }
        if (actor.status === "suspended") {
          return res.status(403).send({ message: "Account suspended. Cannot update products.", code: "SUSPENDED", suspendReason: actor.suspendReason, suspendFeedback: actor.suspendFeedback });
        }

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
        if (!isValidObjectId(id)) {
          return res.status(400).send({ message: "Invalid product id" });
        }

        const actor = await userCollection.findOne({ email: req.decoded_email });
        if (!actor) {
          return res.status(403).send({ message: "User not found", code: "NO_USER" });
        }
        if (!["manager", "admin"].includes(actor.role)) {
          return res.status(403).send({ message: "Only managers or admins can delete products", code: "FORBIDDEN" });
        }
        if (actor.status === "suspended") {
          return res.status(403).send({ message: "Account suspended. Cannot delete products.", code: "SUSPENDED", suspendReason: actor.suspendReason, suspendFeedback: actor.suspendFeedback });
        }

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
        const requesterEmail = req.decoded_email;

        if (
          !orderData.email ||
          orderData.email.toLowerCase() !== requesterEmail.toLowerCase()
        ) {
          return res.status(403).send({
            message: "Cannot place orders for a different account.",
            code: "FORBIDDEN",
          });
        }

        const account = await userCollection.findOne({ email: requesterEmail });
        if (account?.status === "suspended") {
          return res.status(403).send({
            message: "Your account is suspended. New orders are disabled.",
            code: "SUSPENDED",
            suspendReason: account.suspendReason,
            suspendFeedback: account.suspendFeedback,
          });
        }

        orderData.status = "pending"; // Admin approval status
        orderData.paymentStatus = "unpaid"; // Payment status - user can pay without approval
        orderData.createdAt = new Date();

        const result = await orderCollection.insertOne(orderData);
        res.status(201).send({
          message: "Order placed successfully",
          orderId: result.insertedId,
          result,
        });
      } catch (error) {
        res.status(500).send({
          message: "Error placing order",
          error: error.message,
        });
      }
    });

   // payment related apis
    app.post("/payment-checkout-session", verifyFBToken, async (req, res) => {
      try {
        const parcelInfo = req.body || {};
        console.log("/payment-checkout-session called with:", parcelInfo);

        // Validate required fields
        const costValue =
          parcelInfo.cost ?? parcelInfo.totalPrice ?? parcelInfo.amount;
        const senderEmail = parcelInfo.senderEmail || parcelInfo.email;
        if (!costValue || !senderEmail) {
          return res
            .status(400)
            .send({ error: "Missing required fields: cost and senderEmail" });
        }

        // Convert to smallest currency unit (cents)
        const amount = Math.round(Number(costValue) * 0.82);
        if (isNaN(amount) || amount <= 0) {
          return res.status(400).send({ error: "Invalid cost value" });
        }

        const session = await stripe.checkout.sessions.create({
          line_items: [
            {
              price_data: {
                currency: "usd",
                unit_amount: amount,
                product_data: {
                  name: `Please pay for: ${
                    parcelInfo.parcelName || parcelInfo.productTitle || "Order"
                  }`,
                },
              },
              quantity: 1,
            },
          ],
          mode: "payment",
          metadata: {
            orderId: parcelInfo.parcelId,
          },
          customer_email: senderEmail,
          success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
        });

        console.log("Stripe session created:", {
          id: session.id,
          url: session.url,
        });
        res.send({ url: session.url, id: session.id });
      } catch (err) {
        console.error("Error in /payment-checkout-session:", err);
        // Return safe error to client
        res.status(500).send({
          error: "Server error creating checkout session",
          detail: err.message,
        });
      }
    });

    // Update order payment status after successful payment (protected)
    app.patch("/orders/:id/payment-status", verifyFBToken, async (req, res) => {
      try {
        const id = req.params.id;
        if (!isValidObjectId(id)) {
          return res.status(400).send({ message: "Invalid order id" });
        }
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
    });    

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
        const paymentExist = await paymentCollection.findOne({ transactionId });
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
        console.error("Error in /payment-success:", error);
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
        const actor = await userCollection.findOne({ email: req.decoded_email });
        if (!actor) {
          return res.status(403).send({ message: "User not found", code: "NO_USER" });
        }
        if (actor.status === "suspended") {
          return res.status(403).send({ message: "Account suspended. Cannot view orders.", code: "SUSPENDED", suspendReason: actor.suspendReason, suspendFeedback: actor.suspendFeedback });
        }
        if (!(["manager", "admin"].includes(actor.role) || email.toLowerCase() === req.decoded_email.toLowerCase())) {
          return res.status(403).send({ message: "You can only view your own orders", code: "FORBIDDEN" });
        }
        const orders = await orderCollection.find({ email }).toArray();
        res.send(orders);
      } catch (error) {
        res.status(500).send({
          message: "Error fetching orders",
          error: error.message,
        });
      }
    });

    // Get order by id
    app.get("/orders/id/:id", async (req, res) => {
      try {
        const id = req.params.id;
        if (!isValidObjectId(id)) {
          return res.status(400).send({ message: "Invalid order id" });
        }
        const order = await orderCollection.findOne({ _id: new ObjectId(id) });
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
        if (!isValidObjectId(id)) {
          return res.status(400).send({ message: "Invalid order id" });
        }
        const result = await orderCollection.deleteOne({
          _id: new ObjectId(id),
        });
        res.send(result);
      } catch (error) {
        res.status(500).send({
          message: "Error deleting order",
          error: error.message,
        });
      }
    });

    // Get orders (protected)
    // - Managers/Admins: can view all orders (with optional filters)
    // - Regular users: can only view their own orders by passing ?email=<their email>
    app.get("/orders", verifyFBToken, async (req, res) => {
      try {
        const actor = await userCollection.findOne({ email: req.decoded_email });
        if (!actor) {
          return res.status(403).send({ message: "User not found", code: "NO_USER" });
        }
        if (actor.status === "suspended") {
          return res.status(403).send({ message: "Account suspended. Cannot view orders.", code: "SUSPENDED", suspendReason: actor.suspendReason, suspendFeedback: actor.suspendFeedback });
        }

        const { email, status } = req.query;
        const query = {};

        // If requester is manager/admin, allow arbitrary filters
        if (["manager", "admin"].includes(actor.role)) {
          if (email) query.email = email;
          if (status) query.status = status;
        } else {
          // Regular user: only allow fetching their own orders
          if (!email) {
            return res.status(403).send({ message: "Regular users must provide their email to view orders", code: "FORBIDDEN" });
          }
          // Case-insensitive match
          if (email.toLowerCase() !== req.decoded_email.toLowerCase()) {
            return res.status(403).send({ message: "You can only view your own orders", code: "FORBIDDEN" });
          }
          query.email = req.decoded_email;
          if (status) query.status = status;
        }

        const orders = await orderCollection.find(query).toArray();
        res.send(orders);
      } catch (error) {
        res.status(500).send({
          message: "Error fetching orders",
          error: error.message,
        });
      }
    });
    // Generic update order endpoint (protected) - only manager or admin
    app.patch("/orders/:id", verifyFBToken, async (req, res) => {
      try {
        const id = req.params.id;
        if (!isValidObjectId(id)) {
          return res.status(400).send({ message: "Invalid order id" });
        }

        const actor = await userCollection.findOne({ email: req.decoded_email });
        if (!actor) {
          return res.status(403).send({ message: "User not found", code: "NO_USER" });
        }
        if (!["manager", "admin"].includes(actor.role)) {
          return res.status(403).send({ message: "Only managers or admins can update orders", code: "FORBIDDEN" });
        }
        if (actor.status === "suspended") {
          return res.status(403).send({ message: "Account suspended. Cannot update orders.", code: "SUSPENDED", suspendReason: actor.suspendReason, suspendFeedback: actor.suspendFeedback });
        }

        const updateData = req.body;
        const result = await orderCollection.updateOne(
          { _id: new ObjectId(id) },
          {
            $set: {
              ...updateData,
              updatedAt: new Date(),
            },
          }
        );
        res.send(result);
      } catch (error) {
        res.status(500).send({
          message: "Error updating order",
          error: error.message,
        });
      }
    });

    // Update order status
    app.patch("/orders/:id/status", verifyFBToken, async (req, res) => {
      try {
        const id = req.params.id;
        if (!isValidObjectId(id)) {
          return res.status(400).send({ message: "Invalid order id" });
        }
        const { status, approvedAt } = req.body;
        const actor = await userCollection.findOne({
          email: req.decoded_email,
        });

        if (!actor) {
          return res
            .status(403)
            .send({ message: "User not found", code: "NO_USER" });
        }

        if (!["manager", "admin"].includes(actor.role)) {
          return res.status(403).send({
            message: "Only managers or admins can update order status",
            code: "FORBIDDEN",
          });
        }

        if (actor.status === "suspended") {
          return res.status(403).send({
            message:
              "Your account is suspended. Order approval/rejection is disabled.",
            code: "SUSPENDED",
            suspendReason: actor.suspendReason,
            suspendFeedback: actor.suspendFeedback,
          });
        }

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

    // Append tracking update to order
    app.patch("/orders/:id/tracking", async (req, res) => {
      try {
        const id = req.params.id;
        if (!isValidObjectId(id)) {
          return res.status(400).send({ message: "Invalid order id" });
        }
        const update = req.body || {};
        const docUpdate = {
          $push: { trackingUpdates: update },
          $set: { updatedAt: new Date() },
        };
        const result = await orderCollection.updateOne(
          { _id: new ObjectId(id) },
          docUpdate
        );
        res.send(result);
      } catch (error) {
        res.status(500).send({
          message: "Error adding tracking update",
          error: error.message,
        });
      }
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } catch (error) {
    console.error("MongoDB Connection Error:", error);
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Server is running just fine!");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});

// Centralized error handler (last middleware)
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  if (res.headersSent) return next(err);
  res.status(500).send({ message: "Internal server error" });
});
