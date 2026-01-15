# Garments Order & Production Tracker Server

A backend API server for the Garments Order & Production Tracker System, designed to manage garment production workflows, orders, users, and payments with enterprise-grade security and performance.

## Project Overview

This Express.js server provides RESTful APIs to handle:

- **User Management** — authentication, role-based access control (buyers, managers, admins), and account status
- **Product Management** — CRUD operations with full-text search, filtering, pagination, and sorting
- **Order Processing** — order creation, tracking, status updates, and delivery management
- **Payment Integration** — Stripe payment processing with webhook support
- **Dashboard Analytics** — aggregated metrics for admin and manager dashboards
- **Security & Monitoring** — rate limiting, CORS, helmet protection, Firebase token verification

## Technology Stack

| Component | Technology |
|-----------|-----------|
| **Runtime** | Node.js (v14+) |
| **Framework** | Express.js |
| **Database** | MongoDB with MongoDB Driver |
| **Authentication** | Firebase Admin SDK (token verification) |
| **Payments** | Stripe API |
| **Security** | Helmet, CORS, Rate Limiting, Compression |
| **Deployment** | Vercel, AWS Lambda, or any Node.js host |

## Features

- ✅ Secure API endpoints with Firebase token authentication
- ✅ Role-based access control (admin, manager, buyer)
- ✅ Full-featured product CRUD with pagination, search, and filtering
- ✅ Advanced order management with status tracking and delivery notes
- ✅ Stripe payment integration with success/failure handling
- ✅ User suspension system with feedback
- ✅ Dashboard analytics endpoints with data aggregation
- ✅ Rate limiting and CORS protection for deployed domains
- ✅ Comprehensive error handling and logging
- ✅ Serverless-compatible (Firebase Hosting or Vercel)

## Prerequisites

- **Node.js** v14+ with npm/yarn
- **MongoDB** cluster (e.g., MongoDB Atlas) with connection string
- **Firebase Project** with service account key
- **Stripe Account** with test/live keys
- **Environment setup** — see below

## Installation & Setup

### 1. Clone Repository

```bash
git clone <repo-url>
cd Garments-Order-Server
npm install
```

### 2. Create `.env` File

Create a `.env` file in the root directory:

```bash
# Server & Node
PORT=3000
NODE_ENV=development
TRUST_PROXY=0

# Database
DB_USER=your_mongodb_username
DB_PASSWORD=your_mongodb_password
# MongoDB connection string format:
# mongodb+srv://<user>:<password>@<cluster>.mongodb.net/?appName=<app>

# Firebase Service Account (base64-encoded JSON)
# Get from Firebase Console → Project Settings → Service Accounts
FB_SERVICE_KEY=your_base64_encoded_firebase_service_account_key

# Stripe
STRIPE_SECRET=sk_test_... (or sk_live_... for production)

# CORS & Deployment
ALLOWED_ORIGINS=http://localhost:5173,http://localhost:3000,https://garments-order-tracker.web.app
SITE_DOMAIN=http://localhost:3000

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=100
RATE_LIMIT_WHITELIST=127.0.0.1
```

### 3. Start Server

**Development** (with auto-restart):
```bash
npm install -g nodemon
nodemon index.js
```

**Production**:
```bash
npm start
```

Server runs on `http://localhost:3000` by default.

## API Reference

### Authentication

All protected endpoints require a Firebase token in the `Authorization` header:

```bash
Authorization: Bearer <firebase_idToken>
```

Public endpoints do not require authentication.

### Users

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/users` | ❌ | Register a new user |
| `GET` | `/users/:email/role` | ✅ | Get user role and status |
| `GET` | `/users` | ✅ Admin | Get all users |
| `PATCH` | `/users/:id/role` | ✅ Admin | Update user role/status |
| `PATCH` | `/users/:id/suspend` | ✅ Admin | Suspend user with reason |
| `PATCH` | `/users/:id/activate` | ✅ Admin | Activate user |

### Products

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/products` | ❌ | List products with pagination, search, filter, sort |
| `GET` | `/products/:id` | ❌ | Get single product details |
| `GET` | `/products/:id/related` | ❌ | Get related products (same category) |
| `GET` | `/products/categories-summary` | ❌ | Get category counts |
| `POST` | `/products` | ✅ Manager/Admin | Create product |
| `PATCH` | `/products/:id` | ✅ Manager/Admin | Update product |
| `DELETE` | `/products/:id` | ✅ Manager/Admin | Delete product |

**Query Parameters for `GET /products`:**
```bash
?page=1&limit=12                    # Pagination
&search=shirt                       # Full-text search
&category=Shirt,Pant               # Filter by category (comma-separated)
&minPrice=100&maxPrice=500          # Price range filter
&sortBy=price&order=asc             # Sort (price, createdAt, availableQuantity)
```

**Product Schema:**
```json
{
  "productName": "Summer Shirt",
  "productDescription": "Comfortable cotton shirt",
  "productImage": "https://example.com/image.jpg",
  "gallery": ["url1", "url2"],
  "category": "Shirts",
  "price": 49.99,
  "availableQuantity": 100,
  "createdAt": "2025-01-15T10:00:00Z",
  "createdBy": "manager@example.com"
}
```

### Orders

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/orders` | ✅ | Create/place order |
| `GET` | `/orders` | ✅ | Get orders (filtered by role) |
| `GET` | `/orders/id/:id` | ✅ | Get order by ID |
| `GET` | `/orders/:email` | ✅ | Get orders by email |
| `PATCH` | `/orders/:id` | ✅ Manager/Admin | Update order details |
| `PATCH` | `/orders/:id/status` | ✅ Manager/Admin | Update order status |
| `PATCH` | `/orders/:id/tracking` | ✅ Manager | Add tracking update |
| `DELETE` | `/orders/:id` | ✅ Manager/Admin | Delete order |

**Order Statuses:** `pending`, `approved`, `processing`, `shipped`, `delivered`, `cancelled`

### Payments

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/payment-checkout-session` | ✅ | Create Stripe checkout session |
| `PATCH` | `/payment-success` | ❌ | Handle payment success webhook |

### Dashboard Analytics

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/dashboard/admin/overview` | ✅ Admin | Admin dashboard stats |
| `GET` | `/dashboard/manager/overview` | ✅ Manager | Manager dashboard stats |
| `GET` | `/dashboard/buyer/overview` | ✅ Buyer | Buyer dashboard stats |

## Environment Variables Reference

### Server Config
| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | ❌ | 3000 | Server port |
| `NODE_ENV` | ❌ | development | Environment mode |
| `TRUST_PROXY` | ❌ | 0 | Enable trust proxy (for Heroku/Cloudflare) |

### Database
| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DB_USER` | ✅ | - | MongoDB username |
| `DB_PASSWORD` | ✅ | - | MongoDB password |

### Authentication
| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `FB_SERVICE_KEY` | ✅ | - | Base64-encoded Firebase service account JSON |

### Payments
| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `STRIPE_SECRET` | ✅ | - | Stripe secret key (test: sk_test_*, live: sk_live_*) |

### Security & CORS
| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ALLOWED_ORIGINS` | ❌ | localhost:5173,localhost:3000 | Comma-separated list of allowed CORS origins |
| `SITE_DOMAIN` | ❌ | http://localhost:3000 | Domain for Stripe redirects |

### Rate Limiting
| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `RATE_LIMIT_WINDOW_MS` | ❌ | 900000 (15 min) | Rate limit window in milliseconds |
| `RATE_LIMIT_MAX` | ❌ | 100 | Max requests per window (2000 in dev) |
| `RATE_LIMIT_WHITELIST` | ❌ | - | Comma-separated IPs to whitelist from limits |

## Common API Examples

### Register User
```bash
curl -X POST http://localhost:3000/users \
  -H "Content-Type: application/json" \
  -d '{
    "email": "buyer@example.com",
    "displayName": "John Doe",
    "role": "buyer",
    "photoURL": "https://..."
  }'
```

### List Products with Filters
```bash
curl "http://localhost:3000/products?page=1&limit=12&category=Shirts&sortBy=price&order=asc"
```

### Create Order
```bash
curl -X POST http://localhost:3000/orders \
  -H "Authorization: Bearer <idToken>" \
  -H "Content-Type: application/json" \
  -d '{
    "productId": "...",
    "quantity": 2,
    "email": "buyer@example.com",
    "deliveryAddress": "..."
  }'
```

### Update Order Status
```bash
curl -X PATCH http://localhost:3000/orders/<orderId>/status \
  -H "Authorization: Bearer <idToken>" \
  -H "Content-Type: application/json" \
  -d '{ "status": "shipped", "note": "On the way" }'
```

## Deployment

### Deploy to Vercel

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel

# Set environment variables in Vercel dashboard
```

### Deploy to Firebase Hosting

```bash
firebase init functions
firebase deploy --only functions
```

### Deploy to AWS Lambda

Use AWS Serverless Application Model (SAM) or AWS CodeDeploy with Node.js runtime.

## Database Collections

### users
```json
{
  "_id": ObjectId,
  "email": "user@example.com",
  "displayName": "John Doe",
  "photoURL": "https://...",
  "role": "buyer|manager|admin",
  "status": "pending|active|suspended",
  "suspendReason": "Optional reason",
  "suspendFeedback": "Optional feedback",
  "createdAt": ISODate
}
```

### products
```json
{
  "_id": ObjectId,
  "productName": "Summer Shirt",
  "productDescription": "Description here",
  "productImage": "https://...",
  "gallery": ["url1", "url2"],
  "category": "Shirts",
  "price": 49.99,
  "availableQuantity": 100,
  "specifications": { "color": "Blue", "size": "M" },
  "createdAt": ISODate,
  "createdBy": "manager@example.com",
  "updatedAt": ISODate
}
```

### orders
```json
{
  "_id": ObjectId,
  "productId": ObjectId,
  "buyerEmail": "buyer@example.com",
  "quantity": 1,
  "totalPrice": 49.99,
  "status": "pending",
  "deliveryAddress": "...",
  "trackingUpdates": [],
  "createdAt": ISODate,
  "approvedBy": "manager@example.com"
}
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| CORS errors | Check `ALLOWED_ORIGINS` includes frontend URL |
| Firebase auth fails | Verify `FB_SERVICE_KEY` is correct base64-encoded key |
| MongoDB connection error | Check `DB_USER` and `DB_PASSWORD` are correct; whitelist server IP in Atlas |
| Stripe errors | Verify `STRIPE_SECRET` key and that webhook endpoints are configured |
| Rate limiting too strict | Increase `RATE_LIMIT_MAX` in `.env` for local development |

## Contributing

1. Create a feature branch (`git checkout -b feature/name`)
2. Make changes and test locally
3. Commit with clear messages
4. Push and open a pull request

## License & Support

This project is part of the Garments Order Production Tracker System. For issues, open a GitHub issue or contact the maintainer.

## Next Steps

- [ ] Set up automated tests (Jest)
- [ ] Add API documentation with Swagger
- [ ] Implement webhook signing for Stripe
- [ ] Add database migration scripts
- [ ] Set up CI/CD with GitHub Actions
