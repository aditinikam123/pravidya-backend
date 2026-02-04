# Authentication API Documentation

## Admin Login API

### Endpoints

#### 1. General Login (Admin or Counselor)
```
POST /api/auth/login
```

**Request Body:**
```json
{
  "username": "admin",
  "password": "admin123"
}
```

**Response (Success - 200):**
```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": "507f1f77bcf86cd799439011",
      "username": "admin",
      "email": "admin@admissions.com",
      "role": "ADMIN",
      "isAdmin": true,
      "isCounselor": false,
      "counselorProfile": null
    }
  }
}
```

#### 2. Admin-Only Login
```
POST /api/auth/admin/login
```

**Request Body:**
```json
{
  "username": "admin",
  "password": "admin123"
}
```

**Response (Success - 200):**
```json
{
  "success": true,
  "message": "Admin login successful",
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": "507f1f77bcf86cd799439011",
      "username": "admin",
      "email": "admin@admissions.com",
      "role": "ADMIN",
      "isAdmin": true
    }
  }
}
```

**Response (Error - 401):**
```json
{
  "success": false,
  "message": "Invalid admin credentials"
}
```

#### 3. Get Current User
```
GET /api/auth/me
Headers: Authorization: Bearer <token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "507f1f77bcf86cd799439011",
      "username": "admin",
      "email": "admin@admissions.com",
      "role": "ADMIN",
      "isAdmin": true,
      "isCounselor": false
    }
  }
}
```

#### 4. Get Current Admin User
```
GET /api/auth/admin/me
Headers: Authorization: Bearer <token>
Access: Admin only
```

**Response:**
```json
{
  "success": true,
  "message": "Admin profile retrieved successfully",
  "data": {
    "user": {
      "id": "507f1f77bcf86cd799439011",
      "username": "admin",
      "email": "admin@admissions.com",
      "role": "ADMIN",
      "isAdmin": true
    }
  }
}
```

## Role-Based Middleware

### Usage in Routes

#### 1. Authenticate (Any authenticated user)
```javascript
import { authenticate } from '../middleware/auth.js';

router.get('/protected-route', authenticate, handler);
```

#### 2. Admin Only
```javascript
import { authenticate, authorize } from '../middleware/auth.js';

router.get('/admin-only', authenticate, authorize('ADMIN'), handler);
```

#### 3. Counselor Only
```javascript
import { authenticate, authorize } from '../middleware/auth.js';

router.get('/counselor-only', authenticate, authorize('COUNSELOR'), handler);
```

#### 4. Convenience Middleware
```javascript
import { requireAdmin, requireCounselor, requireAuth } from '../middleware/auth.js';

// Admin only
router.get('/admin-route', requireAdmin, handler);

// Counselor only
router.get('/counselor-route', requireCounselor, handler);

// Admin or Counselor
router.get('/auth-route', requireAuth, handler);
```

## JWT Token

### Token Structure
```json
{
  "userId": "507f1f77bcf86cd799439011",
  "role": "ADMIN",
  "iat": 1234567890,
  "exp": 1235173890
}
```

### Token Expiration
- Default: 7 days (configurable via `JWT_EXPIRE` env variable)
- Format: `7d`, `24h`, `3600s`, etc.

### Using Token in Requests
```javascript
// In frontend (fetch/axios)
const response = await fetch('http://localhost:5000/api/admin/dashboard', {
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  }
});
```

## Error Responses

### 401 Unauthorized
```json
{
  "success": false,
  "message": "No token provided. Access denied."
}
```

### 403 Forbidden
```json
{
  "success": false,
  "message": "Access denied. Required role: ADMIN. Your role: COUNSELOR."
}
```

## Example: Complete Admin Login Flow

### 1. Login
```bash
curl -X POST http://localhost:5000/api/auth/admin/login \
  -H "Content-Type: application/json" \
  -d '{
    "username": "admin",
    "password": "admin123"
  }'
```

### 2. Use Token
```bash
curl -X GET http://localhost:5000/api/admin/dashboard \
  -H "Authorization: Bearer <token>"
```

## Security Features

1. **Password Hashing**: Bcrypt with salt rounds (10)
2. **Token Verification**: JWT signature validation
3. **Role Validation**: Token role must match user role
4. **Account Status Check**: Inactive accounts cannot login
5. **Activity Logging**: All login attempts are logged
6. **IP Tracking**: Login IP addresses are recorded

## Testing

### Test Admin Login
```javascript
// Test script
const testAdminLogin = async () => {
  const response = await fetch('http://localhost:5000/api/auth/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'admin',
      password: 'admin123'
    })
  });
  
  const data = await response.json();
  console.log('Token:', data.data.token);
  return data.data.token;
};
```
