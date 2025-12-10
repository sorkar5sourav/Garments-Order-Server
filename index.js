const express = require("express");
const cors = require("cors");
const app = express();
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const stripe = require("stripe")(process.env.STRIPE_SECRET);

const port = process.env.PORT || 3000;
// const crypto = require("crypto");
// middleware
app.use(express.json());
app.use(cors());
// const admin = require("firebase-admin");

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.jskgf2c.mongodb.net/?appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

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

    // Post a new order
    app.post("/orders", async (req, res) => {
      try {
        const orderData = req.body;
        orderData.status = "pending"; // Set initial status
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

    // Get all orders
    app.get("/orders", async (req, res) => {
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

    // Get orders by email (legacy endpoint)
    app.get("/orders/:email", async (req, res) => {
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

    // Delete an order
    app.delete("/orders/:id", async (req, res) => {
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

    // Generic update order endpoint
    app.patch("/orders/:id", async (req, res) => {
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
    // payment related apis
    app.post("/payment-checkout-session", async (req, res) => {
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
            parcelId: parcelInfo.parcelId,
            trackingId: parcelInfo.trackingId,
          },
          customer_email: senderEmail,
          success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
        });
        app.patch("/payment-success", async (req, res) => {
          const sessionId = req.query.session_id;
          const session = await stripe.checkout.sessions.retrieve(sessionId);

          // console.log('session retrieve', session)
          const transactionId = session.payment_intent;
          const query = { transactionId: transactionId };

          const paymentExist = await paymentCollection.findOne(query);
          // console.log(paymentExist);
          if (paymentExist) {
            return res.send({
              message: "already exists",
              transactionId,
              trackingId: paymentExist.trackingId,
            });
          }

          // use the previous tracking id created during the parcel create which was set to the session metadata during session creation
          const trackingId = session.metadata.trackingId;

          if (session.payment_status === "paid") {
            const id = session.metadata.parcelId;
            const query = { _id: new ObjectId(id) };
            const update = {
              $set: {
                paymentStatus: "paid",
                deliveryStatus: "pending-pickup",
              },
            };

            const result = await parcelsCollection.updateOne(query, update);

            const payment = {
              amount: session.amount_total / 100,
              currency: session.currency,
              customerEmail: session.customer_email,
              parcelId: session.metadata.parcelId,
              parcelName: session.metadata.parcelName,
              transactionId: session.payment_intent,
              paymentStatus: session.payment_status,
              paidAt: new Date(),
              trackingId: trackingId,
            };

            const resultPayment = await paymentCollection.insertOne(payment);

            logTracking(trackingId, "parcel_paid");

            return res.send({
              success: true,
              modifyParcel: result,
              trackingId: trackingId,
              transactionId: session.payment_intent,
              paymentInfo: resultPayment,
            });
          }
          return res.send({ success: false });
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
