const express = require("express");
const cors = require("cors");
const app = express();
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
// const stripe = require("stripe")(process.env.STRIPE_SECRET);

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
    //         const paymentCollection = db.collection('payments');
    //         const ridersCollection = db.collection('riders');
    //         const trackingsCollection = db.collection('trackings')

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

    // Get all products
    app.get("/products", async (req, res) => {
      try {
        const products = await productCollection.find({}).toArray();
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
