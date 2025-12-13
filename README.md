# Garments Order & Production Tracker Server

A backend API server for the Garments Order & Production Tracker System, designed to manage garment production workflows, orders, users, and payments.

## Project Overview

This server provides RESTful APIs to handle:

- User authentication and role management (buyers, managers, admins)
- Product management (CRUD operations for garments)
- Order processing and tracking
- Payment integration via Stripe
- Production tracking and status updates

## Technology Stack

- **Runtime**: Node.js
- **Framework**: Express.js
- **Database**: MongoDB (with MongoDB Driver)
- **Authentication**: Firebase Admin SDK for token verification
- **Payments**: Stripe API
- **Security**: Helmet, CORS, Rate Limiting, Compression
- **Deployment**: Vercel (or compatible Node.js hosting)

## Features

- Secure API endpoints with Firebase token authentication
- Role-based access control (admin, manager, buyer)
- Product CRUD with pagination
- Order management with status tracking
- Stripe payment integration
- User suspension and feedback system
- Comprehensive error handling and logging

## Installation

1. Clone the repository:

   ```bash
   git clone https://github.com/sorkar5sourav/Garments-Order-Server.git
   cd Garments-Order-Server
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Create a `.env` file in the root directory with the following variables:

   ```
   PORT=3000
   DB_USER=your_mongodb_username
   DB_PASSWORD=your_mongodb_password
   FB_SERVICE_KEY=your_firebase_service_account_key_base64
   STRIPE_SECRET=your_stripe_secret_key
   FRONTEND_URL=http://localhost:5173
   SITE_DOMAIN=http://localhost:5173
   TRUST_PROXY=0
   RATE_LIMIT_MAX=100
   ```

4. Start the server:
   ```bash
   npm start
   # or for development with auto-restart
   nodemon index.js
   ```

The server will run on `http://localhost:3000` by default.

## API Endpoints

### Users

- `POST /users` - Register a new user
- `GET /users/:email/role` - Get user role and status
- `GET /users` - Get all users (admin only)
- `PATCH /users/:id/role` - Update user role/status (admin only)

### Products

- `GET /products` - Get all products with pagination
- `POST /products` - Create a new product (manager/admin only)
- `PATCH /products/:id` - Update product (manager/admin only)
- `DELETE /products/:id` - Delete product (manager/admin only)

### Orders

- `POST /orders` - Place a new order
- `GET /orders` - Get orders (filtered by role)
- `GET /orders/:email` - Get orders by email
- `GET /orders/id/:id` - Get order by ID
- `PATCH /orders/:id` - Update order (manager/admin only)
- `PATCH /orders/:id/status` - Update order status (manager/admin only)
- `PATCH /orders/:id/tracking` - Add tracking update
- `DELETE /orders/:id` - Delete order

### Payments

- `POST /payment-checkout-session` - Create Stripe checkout session
- `PATCH /payment-success` - Handle payment success

### Other

- `GET /` - Health check

## Environment Variables

- `PORT`: Server port (default: 3000)
- `DB_USER`: MongoDB username
- `DB_PASSWORD`: MongoDB password
- `FB_SERVICE_KEY`: Base64-encoded Firebase service account key
- `STRIPE_SECRET`: Stripe secret key
- `FRONTEND_URL`: Frontend URL for CORS
- `SITE_DOMAIN`: Domain for Stripe success/cancel URLs
- `TRUST_PROXY`: Enable trust proxy (1 for production)
- `RATE_LIMIT_MAX`: Max requests per IP per 15 minutes

## Usage

1. Ensure MongoDB is running and accessible.
2. Set up Firebase project and generate service account key.
3. Configure Stripe account and get secret key.
4. Start the server and test endpoints with tools like Postman or curl.

Example curl for health check:

```bash
curl http://localhost:3000/
```

## Deployment

This server is configured for deployment on Vercel or similar Node.js platforms. Ensure environment variables are set in your deployment provider.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

This project is licensed under the ISC License.
