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
