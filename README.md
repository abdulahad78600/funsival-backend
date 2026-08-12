# Funsival Backend

Funsival now has a scalable Express + MongoDB auth API with support for two roles:

- `user`
- `host`

## Setup

1. Install dependencies:
   ```sh
   npm install
   ```
2. Configure environment variables:
   ```sh
   cp .env.example .env
   ```
3. Start the server:
   ```sh
   npm start
   ```

## Project Structure

```text
src/
  app.js
  index.js
  config/
  constants/
  middlewares/
  models/
  modules/
    auth/
  routes/
  utils/
```

## Auth Endpoints

### `POST /api/v1/auth/signup/user`

```json
{
  "email": "user@example.com",
  "city": "Lahore",
  "password": "password123",
  "confirmPassword": "password123"
}
```

Returns an unverified account response and sends a 6-digit verification code to the user's email.
The signup response message is: `Verification OTP sent to your email.`

### `POST /api/v1/auth/signup/host`

`agencyName` is optional during host signup.

```json
{
  "email": "host@example.com",
  "city": "Karachi",
  "password": "password123",
  "confirmPassword": "password123"
}
```

Returns an unverified account response and sends a 6-digit verification code to the host's email.
The signup response message is: `Verification OTP sent to your email.`

### `POST /api/v1/auth/verify-email`

```json
{
  "email": "user@example.com",
  "code": "123456"
}
```

For a verified `user`, the response becomes:

```json
{
  "success": true,
  "message": "User account created successfully.",
  "data": {
    "token": "jwt-token",
    "user": {
      "role": "user",
      "email": "user@example.com",
      "city": "Lahore",
      "createdAt": "2026-04-14T07:40:56.662Z",
      "updatedAt": "2026-04-14T07:40:56.662Z",
      "id": "mongodb-user-id"
    }
  }
}
```

### `POST /api/v1/auth/resend-verification-code`

```json
{
  "email": "user@example.com"
}
```

### `POST /api/v1/auth/google`

Send the Google `idToken` from your frontend. `role`, `city`, and `agencyName` are optional. If omitted, the account defaults to the `user` role.

```json
{
  "idToken": "google-id-token-from-frontend",
  "role": "user"
}
```

If you want to create a host account with Google:

```json
{
  "idToken": "google-id-token-from-frontend",
  "role": "host"
}
```

### `POST /api/v1/auth/login`

```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

Login is allowed only after the email is verified.

### `POST /api/v1/auth/forgot-password`

```json
{
  "email": "user@example.com"
}
```

### `GET /api/v1/auth/reset-password/:token`

Opens a browser-based reset password form from the email link.

### `POST /api/v1/auth/reset-password/:token`

```json
{
  "password": "NewPassword123",
  "confirmPassword": "NewPassword123"
}
```

### `GET /api/v1/auth/profile`

Headers:

```text
Authorization: Bearer <your-jwt-token>
```

## Listings Endpoints

Listings are private and host-only. Every listing is automatically tied to the authenticated host through `createdBy`.

### `POST /api/v1/listings/images`

Upload listing images before creating or updating the listing.

Headers:

```text
Authorization: Bearer <host-jwt-token>
Content-Type: multipart/form-data
```

Form field:

```text
images=<image-file>
```

Response:

```json
{
  "success": true,
  "message": "Listing images uploaded successfully.",
  "data": {
    "images": [
      {
        "fileName": "1714060000000-uuid.jpg",
        "originalName": "cover.jpg",
        "contentType": "image/jpeg",
        "size": 245123,
        "path": "/uploads/listings/1714060000000-uuid.jpg",
        "url": "https://api.funsival.com/uploads/listings/1714060000000-uuid.jpg"
      }
    ],
    "photos": [
      "/uploads/listings/1714060000000-uuid.jpg"
    ]
  }
}
```

Use the returned `photos` values in the listing `photos` array. The backend serves uploaded files from `/uploads/listings/*`.

### `POST /api/v1/listings`

Headers:

```text
Authorization: Bearer <host-jwt-token>
```

```json
{
  "category": "Adventure",
  "type": "Outdoor Activity",
  "basicInformation": {
    "activityTitle": "Sunrise Hiking Experience",
    "location": "Lahore",
    "description": "A guided sunrise hike with scenic viewpoints and local storytelling."
  },
  "serviceDetails": {
    "difficultyLevel": "beginner",
    "duration": {
      "value": 3,
      "unit": "hours"
    },
    "maxParticipants": 12,
    "instructorName": "Ali Khan",
    "cancellationPolicy": "Free cancellation up to 24 hours before the activity.",
    "whatsIncluded": [
      "Guide",
      "Refreshments",
      "Safety briefing"
    ],
    "requirements": [
      "Comfortable shoes",
      "Water bottle"
    ]
  },
  "placeLocation": {
    "addressLine1": "Trail Start Point, Margalla Hills",
    "addressLine2": "",
    "city": "Islamabad",
    "state": "Islamabad Capital Territory",
    "country": "Pakistan",
    "postalCode": "44000",
    "latitude": 33.7294,
    "longitude": 73.0931,
    "googleMapsUrl": "https://maps.google.com"
  },
  "photos": [
    "/uploads/listings/1714060000000-uuid.jpg",
    "/uploads/listings/1714060000001-uuid.jpg"
  ],
  "availability": [
    {
      "day": "saturday",
      "startTime": "06:00",
      "endTime": "09:00",
      "isAvailable": true
    }
  ],
  "price": {
    "amount": 4500,
    "currency": "PKR"
  }
}
```

### `GET /api/v1/listings`

Returns the authenticated host's own listings.

### `GET /api/v1/listings/:listingId`

Returns one listing owned by the authenticated host.

### `PATCH /api/v1/listings/:listingId`

Allows partial updates. Send only the fields you want to change.

### `DELETE /api/v1/listings/:listingId`

Deletes one listing owned by the authenticated host.

## User Endpoints

### `PATCH /api/v1/users/provider-profile`

Provider-only profile update endpoint.

Headers:

```text
Authorization: Bearer <host-jwt-token>
```

Request body example:

```json
{
  "firstName": "John",
  "lastName": "Doe",
  "email": "john.doe@example.com",
  "phoneNumber": "+1 (555) 123-4567",
  "dateOfBirth": "1990-05-14",
  "bio": "Tell us about yourself...",
  "profileImage": "https://example.com/profile.jpg",
  "addressLine1": "123 Main Street",
  "addressLine2": "Suite 4B",
  "city": "San Francisco",
  "state": "California",
  "postalCode": "94102",
  "country": "United States",
  "businessName": "Adventure Hub",
  "businessType": "Outdoor Activities"
}
```

Notes:

- `businessName` is synced to the existing host `agencyName` field.
- `city` is synced to the existing top-level `city` field.
- All fields are optional, so you can send only the fields you want to update.

## Utility Endpoints

- `GET /` basic API status
- `GET /health` API and MongoDB connection status

## Host Dashboard

Frontend developers should start with the complete handoff guide:
[`docs/FRONTEND_HOST_DASHBOARD_HANDOFF.md`](docs/FRONTEND_HOST_DASHBOARD_HANDOFF.md).

`GET /api/v1/dashboard/host/overview` (host authentication required) supplies
the dashboard cards and panels in one request. Optional query parameters:

- `recentLimit`: recent reservations to return, default `5`, maximum `20`
- `currency`: optional three-letter currency such as `USD`

The response includes:

- all-time net earnings per currency, current/previous quarter earnings, and
  quarter-over-quarter percentage change
- active listing count and active listings added this month
- total and pending reservation counts
- completed count and success rate across decided reservations
- recent reservations with listing image/category/type and customer details
- completed, open/pending, and cancelled listing-performance counts/percentages
- booked and pending utilization counts/percentages, based on all reservations

Use the dashboard overview together with these report endpoints:

- Earnings graph: `GET /api/v1/payments/connect/earnings?range=24h|7d|30d|12m`
- Transactions: `GET /api/v1/payments/connect/transactions`
- Full host reservation list: `GET /api/v1/bookings/host`
- Full host listing list: `GET /api/v1/listings`

## Host Reservation Filters

`GET /api/v1/bookings/host` (host authentication required) supports all controls
shown on the reservations table:

- `tab`: `all` (default), `upcoming`, `completed`, or `cancelled`
- `search`: booking ID, listing title/location/category/type, or customer
  name/email/city
- `date`: scheduled reservation date in `YYYY-MM-DD`, `MM/DD/YY`, or
  `MM/DD/YYYY` format; multi-day reservations are included when they overlap
  the selected date
- `page`: page number, default `1`
- `limit`: items per page, default `10`, maximum `100`

Example:

```text
GET /api/v1/bookings/host?tab=upcoming&search=quad%20bike&date=09/24/2026&page=1&limit=10
```

The response includes `filters.counts` for the All, Upcoming, Completed, and
Cancelled tab labels. Search and date filters are reflected in these counts.

`GET /api/v1/bookings/host/stats` returns the four reservation-page cards:
total reservations with the change from last week, host revenue per currency
with month-over-month change, unique active customers/new customers this week,
and the completion rate/month-over-month percentage-point change. It also
returns the reservation tab counts.

`GET /api/v1/bookings/host/export` downloads up to 10,000 matching reservations
as UTF-8 CSV. It accepts the same `tab`, `search`, and `date` filters as the list
endpoint, so the export matches the current table view.

## Payment Hold, Refund, and Withdrawal Flow

New booking payments use Stripe separate charges and transfers:

1. The guest's card is authorized when the booking is submitted.
2. The charge is captured when the host accepts the booking.
3. The merchant's net amount remains on the platform for
   `STRIPE_PAYOUT_DELAY_DAYS` (7 days by default).
4. A refund request submitted during those 7 days freezes the merchant transfer
   until an admin approves or rejects it.
5. An approved request refunds the guest. A rejected request is released at the
   end of the hold, or immediately if the hold has already ended.
6. With no refund request, the background release job transfers the merchant net
   amount to the connected account automatically after the hold.
7. Connected accounts use manual payouts, so merchants withdraw only their
   current (Stripe-available) balance.

This is a delayed marketplace transfer, not a Stripe-provided legal escrow account.
Use a least-privilege Stripe restricted API key (`rk_...`) for the backend when
your configured permissions support all payment, Connect, refund, transfer,
balance, and payout operations used here.

### Merchant balance

`GET /api/v1/payments/connect/balance` (host authentication required) returns one
entry per currency:

```json
{
  "currency": "USD",
  "pending": 97.2,
  "current": 50,
  "breakdown": {
    "sevenDayHold": 97.2,
    "stripeProcessing": 0
  }
}
```

`pending` is not withdrawable. `current` is the connected account's available
Stripe balance and is the maximum source for a withdrawal.

### Merchant earnings graph

`GET /api/v1/payments/connect/earnings` (host authentication required) returns
zero-filled graph points and a summary for each currency. Query parameters:

- `range`: `24h`, `7d` (default), `30d`, or `12m`
- `currency`: optional three-letter currency such as `USD`

The `24h` range returns hourly points, `7d` and `30d` return daily points, and
`12m` returns monthly points.
Earnings use the booking payment date and the host's net `merchantAmount` after
the platform fee. Pending, available, refunded, and disputed amounts are
reported separately, and currencies are never added together.

Example: `GET /api/v1/payments/connect/earnings?range=30d&currency=USD`

### Merchant transaction history

`GET /api/v1/payments/connect/transactions` (host authentication required)
returns a single newest-first history containing booking earnings and bank
withdrawals. Query parameters:

- `page`: page number, default `1`
- `limit`: items per page, default `20`, maximum `100`
- `type`: `all` (default), `earning`, or `withdrawal`
- `currency`: optional three-letter currency such as `USD`

Each transaction has an `earning`/`withdrawal` type, a `credit`/`debit`
direction, amount, currency, status, and transaction date. Earning entries also
include their booking, listing, customer, gross amount, and platform fee.

### Merchant withdrawal

`POST /api/v1/payments/connect/withdrawals` (host authentication required)

Headers:

```text
Authorization: Bearer <host-jwt-token>
Idempotency-Key: <a unique value generated by the client>
```

Body:

```json
{
  "amount": 50,
  "currency": "USD"
}
```

Use the same `Idempotency-Key` when retrying the same request. Withdrawal history
is available from `GET /api/v1/payments/connect/withdrawals?page=1&limit=20`.

### Refund requests

- Guest create: `POST /api/v1/bookings/:bookingId/refund-request`
- Guest status: `GET /api/v1/bookings/:bookingId/refund-request`
- Guest withdraw request: `DELETE /api/v1/bookings/:bookingId/refund-request`
- Admin list: `GET /api/v1/admin/refund-requests`
- Admin approve: `POST /api/v1/admin/refund-requests/:requestId/approve`
- Admin reject: `POST /api/v1/admin/refund-requests/:requestId/reject`

### Stripe deployment requirements

Keep both signed webhook endpoints configured:

- Platform: `/api/v1/webhooks/stripe` for PaymentIntent, refund, and dispute events.
- Connect: `/api/v1/webhooks/stripe/connect` for `account.updated` and `payout.*` events.

The API process runs the eligible-funds release job every minute. Transfer,
refund, and payout calls use idempotency keys, so multiple API instances can run
the job safely. Existing destination-charge bookings are never transferred a
second time; only new `platform_hold` bookings use the delayed transfer.

## Email Configuration

Add these variables to `.env` to send password reset emails:

```text
API_BASE_URL=http://localhost:3000
FRONTEND_URL=http://localhost:3000,https://testing.funsival.com,https://funsival.com,https://www.funsival.com
GOOGLE_CLIENT_ID=your-google-web-client-id
EMAIL_VERIFICATION_CODE_TTL_MINUTES=10
PASSWORD_RESET_TOKEN_TTL_MINUTES=15
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@example.com
SMTP_PASS=your-email-app-password
MAIL_FROM=your-email@example.com
```

Set `API_BASE_URL` to your deployed backend domain in production so uploaded listing image URLs point to the correct host.
Set `FRONTEND_URL` as a comma-separated allowlist when you need multiple frontends, for example `http://localhost:3000,https://testing.funsival.com,https://funsival.com,https://www.funsival.com`.
For Stripe redirects, set `STRIPE_ONBOARDING_RETURN_URL` to the host post-connect page and `STRIPE_CHECKOUT_SUCCESS_URL` to the guest booking success page. The current testing defaults are `https://testing.funsival.com/dashboard/listings` and `https://testing.funsival.com/user-dashboard/booking-success`.
