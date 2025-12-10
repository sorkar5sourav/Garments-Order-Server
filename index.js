const express = require("express");
const cors = require("cors");
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

function generateTrackingId() {
  const prefix = "PRCL"; // your brand prefix
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, ""); // YYYYMMDD
  const random = crypto.randomBytes(3).toString("hex").toUpperCase(); // 6-char random hex

  return `${prefix}-${date}-${random}`;
}

app.use(express.json());
app.use(cors());

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
  const token = req.headers.authorization;

  if (!token) {
    return res.status(401).send({ message: "unauthorized access" });
  }

  try {
    const idToken = token.split(" ")[1];
    const decoded = await admin.auth().verifyIdToken(idToken);
    console.log("decoded in the token", decoded);
    req.decoded_email = decoded.email;
    next();
  } catch (err) {
    return res.status(401).send({ message: "unauthorized access" });
  }
};
async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();
    const db = client.db("Garments-Order-Production-Tracker-db");
    const userCollection = db.collection("users");
    const productCollection = db.collection("products");
    const orderCollection = db.collection("orders");
    const paymentCollection = db.collection("payments");
    //         const ridersCollection = db.collection('riders');
    //         const trackingsCollection = db.collection('trackings')

    // users related apis
    app.post("/users", async (req, res) => {
      const user = req.body;
      user.role = "user";
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
      res.send({ role: user?.role || "user" });
    });

    // admin - get all users (supports search and filters via query params)
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
        const { role, status } = req.body;

        const updateDoc = { $set: { updatedAt: new Date() } };
        if (role) updateDoc.$set.role = role;
        if (status) updateDoc.$set.status = status;

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
        const { createdBy } = req.query;
        const query = {};
        if (createdBy) query.createdBy = createdBy;

        const products = await productCollection.find(query).toArray();
        res.send(products);
      } catch (error) {
        res
          .status(500)
          .send({ message: "Error fetching products", error: error.message });
      }
    });

    // Post a new product
    app.post("/products", async (req, res) => {
      try {
        const product = req.body;
        product.createdAt = new Date();

        const result = await productCollection.insertOne(product);
        res.send(result);
      } catch (error) {
        res
          .status(500)
          .send({ message: "Error adding product", error: error.message });
      }
    });

    // Update product
    app.patch("/products/:id", async (req, res) => {
      try {
        const id = req.params.id;
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

    // Delete product
    app.delete("/products/:id", async (req, res) => {
      try {
        const id = req.params.id;
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

    // Get all orders (protected)
    app.get("/orders", verifyFBToken, async (req, res) => {
      try {
        const { email, status } = req.query;
        const query = {};

        if (email) {
          query.email = email;
        }
        if (status) {
          query.status = status;
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

    // Get orders by email (protected - legacy endpoint)
    app.get("/orders/:email", verifyFBToken, async (req, res) => {
      try {
        const email = req.params.email;
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
        const order = await orderCollection.findOne({ _id: new ObjectId(id) });
        res.send(order || {});
      } catch (error) {
        res.status(500).send({
          message: "Error fetching order",
          error: error.message,
        });
      }
    });

    // Get order by trackingId (protected)
    app.get("/orders/track/:trackingId", verifyFBToken, async (req, res) => {
      try {
        const trackingId = req.params.trackingId;
        const order = await orderCollection.findOne({ trackingId });
        res.send(order || {});
      } catch (error) {
        res.status(500).send({
          message: "Error fetching order by trackingId",
          error: error.message,
        });
      }
    });

    // Delete an order (protected)
    app.delete("/orders/:id", verifyFBToken, async (req, res) => {
      try {
        const id = req.params.id;
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

    // Generic update order endpoint (protected)
    app.patch("/orders/:id", verifyFBToken, async (req, res) => {
      try {
        const id = req.params.id;
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
    app.patch("/orders/:id/status", async (req, res) => {
      try {
        const id = req.params.id;
        const { status, approvedAt } = req.body;
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
    // Update order payment status after successful payment (protected)
    app.patch("/orders/:id/payment-status", verifyFBToken, async (req, res) => {
      try {
        const id = req.params.id;
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
        const amount = Math.round(Number(costValue) * 100);
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
