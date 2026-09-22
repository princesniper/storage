
# Development PRD

## Telegram-Backed Image Storage & Stable URL Platform

**Version:** 1.0
**Status:** Development Ready
**Primary Use Case:** GrowPlants image hosting
**Secondary Use Case:** Personal image storage
**Primary Storage Backend:** Telegram
**Primary User:** Single Admin / Owner
**Target Builder:** GLM 5.3

---

# 1. Product Definition

Build a secure, private web application that provides a simple image-storage dashboard on top of a Telegram-backed storage system.

The user should be able to:

1. Login to the dashboard.
2. Connect their Telegram account.
3. Register one or more private Telegram storage channels.
4. Select a storage channel.
5. Upload an image.
6. Store that image in the selected Telegram channel.
7. Generate a stable public URL for the image.
8. Copy that URL.
9. Use that URL inside the GrowPlants Admin Panel.
10. Serve the image publicly through the stable URL.
11. Manage and delete uploaded files.
12. Add additional storage channels in the future.

---

# 2. Core Architecture

```text
                    ┌────────────────────────┐
                    │    Storage Dashboard   │
                    │                        │
                    │ Login                  │
                    │ Upload                 │
                    │ Files                  │
                    │ Channels               │
                    │ Settings               │
                    └───────────┬────────────┘
                                │
                                ▼
                    ┌────────────────────────┐
                    │      Application       │
                    │        Backend         │
                    │                        │
                    │ Auth                   │
                    │ Upload API             │
                    │ File Service           │
                    │ Telegram Service       │
                    │ URL Service            │
                    └───────┬─────────┬──────┘
                            │         │
                    ┌───────▼───┐ ┌──▼────────────┐
                    │ Database  │ │    Telegram   │
                    │           │ │ Private       │
                    │ File map  │ │ Channels      │
                    │ URLs      │ │               │
                    │ Metadata  │ │ Actual files  │
                    └───────────┘ └───────────────┘
                            │
                            ▼
                 https://storage-domain/i/{id}
                            │
                            ▼
                     GrowPlants Website
```

---

# 3. Critical Design Principle

The system MUST NOT expose Telegram's raw file URL as the public URL.

Instead:

```text
Telegram
    ↓
Telegram File Reference
    ↓
Our Backend
    ↓
Stable Public URL
```

Example:

```text
https://storage.growplants.in/i/gp_x82ka91
```

The public URL belongs to our system.

---

# 4. User Roles

### V1

Only one role:

```text
ADMIN
```

Admin has complete access to:

* Upload
* Files
* Delete
* Channels
* Settings
* Telegram connection

Public users have:

* No dashboard access
* No file management access

They can only request an active public image URL.

---

# 5. Authentication Requirements

Dashboard must be protected.

### Login

```text
Email / Username
Password
[Login]
```

Requirements:

* Password must never be stored in plaintext.
* Session must be server-side or securely signed.
* Protected routes must reject unauthenticated users.
* API endpoints must validate authentication independently.
* Logout must invalidate the session.

Future support:

* Google login
* Firebase Auth
* 2FA

Not required for V1.

---

# 6. Telegram Integration

Telegram is the underlying storage provider.

The implementation must evaluate and use the appropriate Telegram API/client approach for the chosen account model.

### Important

Do not expose:

```text
api_id
api_hash
phone number
Telegram session
authentication credentials
```

to the browser.

All Telegram operations must happen server-side.

---

# 7. Telegram Connection Flow

First-time setup:

```text
Dashboard
    ↓
Connect Telegram
    ↓
Phone Number
    ↓
OTP
    ↓
2FA Password if enabled
    ↓
Authenticated Telegram Session
```

After successful authentication:

```text
Telegram Account
      ↓
Connected
```

Session must be securely persisted so the user does not need to authenticate on every upload.

---

# 8. Storage Channels

The system must support multiple Telegram storage channels.

Example:

```text
Telegram Account
│
├── 🌿 GrowPlants Storage
├── 📸 Personal Photos
└── 📁 Documents
```

Each channel becomes a **Storage Destination**.

---

# 9. Storage Destination Data

Each registered channel must have:

```text
id
name
telegramChannelId
type
purpose
status
createdAt
updatedAt
```

Example:

```json
{
  "name": "GrowPlants Storage",
  "telegramChannelId": "-100123456789",
  "purpose": "GrowPlants website images",
  "status": "active"
}
```

---

# 10. Channel Management

Dashboard:

```text
Storage Channels

🌿 GrowPlants Storage
Active
[Use] [Manage]

📸 Personal Photos
Active
[Use] [Manage]

[+ Add Storage Channel]
```

Actions:

* Add
* View
* Rename
* Activate/deactivate
* Test connection
* Delete registration

Deleting a channel registration MUST NOT automatically delete all Telegram content unless explicitly implemented as a separate destructive action.

---

# 11. Upload System

Upload page:

```text
Upload Image

Storage Destination
[ GrowPlants Storage ▼ ]

Drop image here
or
[ Choose File ]

[Upload]
```

Supported V1 formats:

```text
JPEG
PNG
WEBP
GIF
```

The implementation should define configurable file-size limits.

---

# 12. Upload Process

```text
Browser
  ↓
POST /api/files/upload
  ↓
Authentication Check
  ↓
File Validation
  ↓
Selected Storage Channel
  ↓
Telegram Upload
  ↓
Telegram Message/File Reference
  ↓
Generate Internal File ID
  ↓
Save Metadata
  ↓
Return Stable URL
```

Response example:

```json
{
  "success": true,
  "file": {
    "id": "gp_x82ka91",
    "name": "money-plant.jpg",
    "url": "https://storage.example.com/i/gp_x82ka91"
  }
}
```

---

# 13. File Validation

Backend MUST validate:

* MIME type
* File extension
* File size
* File integrity

Do not trust only the filename extension.

Example:

```text
evil.exe.jpg
```

must not automatically be considered an image.

---

# 14. File Metadata

Every file should have a database record.

Recommended schema:

```text
File
├── id
├── publicId
├── originalName
├── mimeType
├── extension
├── size
├── telegramChannelId
├── telegramMessageId
├── telegramFileReference
├── publicUrl
├── status
├── createdAt
├── updatedAt
└── deletedAt
```

---

# 15. Public URL

URL format:

```text
https://storage.example.com/i/{publicId}
```

Example:

```text
https://storage.example.com/i/gp_x82ka91
```

`publicId` must be:

* Unique
* Non-sequential
* Hard to guess
* Stable

Recommended approach:

```text
UUID
```

or cryptographically secure random ID.

---

# 16. Public Image Endpoint

Example:

```text
GET /i/:publicId
```

Flow:

```text
GET /i/gp_x82ka91
        ↓
Find file
        ↓
Check status
        ↓
Resolve Telegram file
        ↓
Retrieve image
        ↓
Return image
```

Response:

```text
Content-Type: image/jpeg
```

---

# 17. HTTP Caching

Public image responses should support appropriate caching headers.

Example concept:

```text
Cache-Control:
public, max-age=...
```

Exact caching strategy should be determined during implementation.

The system should support future CDN integration.

---

# 18. Image Loading Architecture

First request:

```text
Browser
 ↓
Stable URL
 ↓
Backend
 ↓
Telegram
 ↓
Image
```

Subsequent requests:

```text
Browser
 ↓
Cache/CDN
 ↓
Image
```

The backend should avoid unnecessarily downloading the same Telegram file repeatedly.

---

# 19. Cache Requirements

Implement a cache layer where practical.

Cache key:

```text
file:{publicId}
```

Cached data:

* Image bytes
* MIME type
* Metadata

Cache invalidation must occur when:

* File is deleted
* File becomes inactive
* File is replaced

---

# 20. File Dashboard

Page:

```text
Files
```

Features:

* Grid view
* List view
* Thumbnail
* Filename
* Size
* Storage destination
* Upload date
* Status
* Copy URL
* Open
* Delete

---

# 21. Search

Search by:

* Filename
* Public ID
* Storage destination

Example:

```text
Search:
[ money plant          ]
```

---

# 22. Filters

Filters:

```text
Storage:
[All]
[GrowPlants]
[Personal Photos]

Type:
[Images]

Status:
[Active]
[Deleted]
```

---

# 23. Upload Result

After upload:

```text
✓ Upload Successful

money-plant.webp

Public URL

https://storage.example.com/i/gp_x82ka91

[Copy URL]
[Open]
[Upload Another]
```

Copy button must provide visual confirmation:

```text
✓ Copied
```

---

# 24. Delete System

Delete button:

```text
[Delete]
```

Confirmation:

```text
Delete this file?

This will make the public URL unavailable.

[Cancel] [Delete]
```

Recommended V1 behavior:

1. Mark database record deleted.
2. Disable public URL.
3. Attempt Telegram deletion.
4. Record success/failure.
5. Keep audit information.

---

# 25. Error Handling

The system must gracefully handle:

### Telegram unavailable

```text
Telegram connection unavailable.
Please try again.
```

### Upload failed

```text
Upload failed.
Your file was not stored.
```

### Invalid file

```text
Unsupported file type.
```

### File missing

```text
Image unavailable.
```

### Deleted file

```text
404 Not Found
```

Do not expose stack traces to users.

---

# 26. Dashboard Overview

Dashboard should show:

```text
Storage Overview

Total Files        128
Images             128
Active Channels      2
Recent Uploads       8

Telegram Status
● Connected
```

---

# 27. Recent Uploads

Show:

```text
Recent Uploads

money-plant.jpg
GrowPlants Storage
2 minutes ago

snake-plant.webp
GrowPlants Storage
10 minutes ago
```

---

# 28. GrowPlants Integration

No deep coupling is required in V1.

The Storage System only needs to provide:

```text
Public Image URL
```

GrowPlants Admin Panel stores it normally.

Example:

```json
{
  "images": [
    "https://storage.example.com/i/gp_abc123",
    "https://storage.example.com/i/gp_def456"
  ]
}
```

---

# 29. Multiple Image Support

A product can have multiple image URLs.

Example:

```text
Product
│
├── Main Image
├── Gallery Image 1
├── Gallery Image 2
├── Gallery Image 3
└── Gallery Image 4
```

All URLs can point to the storage system.

---

# 30. Personal Storage

Personal storage must remain separate logically.

Example:

```text
GrowPlants Storage
Purpose: Website

Personal Photos
Purpose: Personal
```

The dashboard should never accidentally mix the two destinations.

---

# 31. Storage Selection

Every upload must explicitly have a destination.

Example:

```text
Storage Destination
[ GrowPlants Storage ▼ ]
```

The selected destination's Telegram channel ID is resolved server-side.

Never accept arbitrary Telegram channel IDs from an untrusted client request.

---

# 32. API Design

Suggested API structure:

```text
POST   /api/auth/login
POST   /api/auth/logout
GET    /api/auth/session

GET    /api/files
POST   /api/files/upload
GET    /api/files/:id
DELETE /api/files/:id

GET    /api/channels
POST   /api/channels
GET    /api/channels/:id
PATCH  /api/channels/:id
DELETE /api/channels/:id
POST   /api/channels/:id/test

GET    /i/:publicId
```

These are logical endpoints. Final implementation may adjust them.

---

# 33. Database Requirements

Minimum entities:

```text
Admin
TelegramAccount
StorageChannel
File
UploadLog
```

### Admin

```text
id
email
passwordHash
createdAt
updatedAt
```

### TelegramAccount

```text
id
name
phoneReference
sessionReference
status
createdAt
updatedAt
```

Sensitive Telegram session data must be encrypted/protected.

### StorageChannel

```text
id
telegramAccountId
name
telegramChannelId
purpose
status
createdAt
updatedAt
```

### File

```text
id
publicId
storageChannelId
originalName
mimeType
size
telegramMessageId
telegramFileReference
status
createdAt
updatedAt
deletedAt
```

### UploadLog

```text
id
fileId
operation
status
error
createdAt
```

---

# 34. Security Architecture

Security is a first-class requirement.

### Never expose

```text
TELEGRAM_API_ID
TELEGRAM_API_HASH
TELEGRAM_SESSION
DATABASE_URL
AUTH_SECRET
```

to client-side JavaScript.

Use server-side environment variables/secrets.

---

# 35. API Security

Every admin API must verify authentication.

Example:

```text
POST /api/files/upload
        ↓
Is authenticated?
        ↓
NO → 401
YES
 ↓
Validate file
 ↓
Upload
```

Public endpoint:

```text
GET /i/:publicId
```

does not require dashboard authentication.

---

# 36. Rate Limiting

Public image endpoint should be protected against obvious abuse.

Consider rate limits for:

* Login
* Upload
* Delete
* Channel management

Image delivery may need a higher/optimized limit because it is public.

---

# 37. Logging

Log important operations:

```text
LOGIN
UPLOAD_STARTED
UPLOAD_SUCCESS
UPLOAD_FAILED
FILE_DELETED
CHANNEL_ADDED
CHANNEL_REMOVED
TELEGRAM_ERROR
```

Never log:

* Telegram session
* Password
* API hash
* Sensitive tokens

---

# 38. UI Requirements

Design direction:

**Modern, minimal, dark-first storage dashboard.**

Suggested layout:

```text
┌──────────────────────────────────────────┐
│ Storage                         👤 Admin │
├──────────┬───────────────────────────────┤
│          │                               │
│ Dashboard│                               │
│ Files    │       Main Content            │
│ Upload   │                               │
│ Channels │                               │
│ Settings │                               │
│          │                               │
└──────────┴───────────────────────────────┘
```

Responsive:

* Desktop
* Tablet
* Mobile

---

# 39. Upload UX

Support:

* Drag & drop
* File picker
* Upload progress
* Preview
* Cancel before completion
* Success state
* Failure state

---

# 40. File Grid

Image cards:

```text
┌───────────────────┐
│                   │
│      IMAGE        │
│                   │
├───────────────────┤
│ money-plant.jpg   │
│ 1.2 MB            │
│                   │
│ [Copy] [Open] [⋮] │
└───────────────────┘
```

---

# 41. Responsive Requirements

Mobile:

```text
Dashboard
Files
Upload
Channels
Settings
```

must remain usable.

File grid can switch:

```text
Desktop → 4 columns
Tablet  → 3 columns
Mobile  → 2 columns
```

Exact UI values can be decided during implementation.

---

# 42. Configuration

Environment configuration should support:

```text
APP_URL
DATABASE_URL
AUTH_SECRET

TELEGRAM_API_ID
TELEGRAM_API_HASH
TELEGRAM_SESSION
```

Exact names may change based on implementation.

---

# 43. Deployment Requirements

The final application must support production deployment.

Required separation:

```text
Development
Staging
Production
```

Production secrets must not be committed to Git.

`.env` files containing secrets must be ignored.

---

# 44. Backup Strategy

Database metadata must be independently backed up.

Telegram is **not** the only thing that needs consideration.

If database metadata is lost, stable URL mappings may be lost even if files still exist in Telegram.

Therefore:

```text
Telegram
+
Database Backup
```

are both important.

---

# 45. Important Reliability Rule

The system must never assume:

> Telegram file ID = permanent public URL.

Instead:

```text
Our Public ID
       ↓
Database Mapping
       ↓
Telegram Reference
```

The public ID remains the application's canonical identifier.

---

# 46. URL Stability

Example:

```text
https://storage.example.com/i/gp_abc123
```

must remain associated with the same logical file.

Even if the underlying Telegram retrieval mechanism needs to change, the application should preserve this mapping where technically possible.

---

# 47. Observability

Admin should be able to see:

```text
Telegram:
● Connected

Database:
● Connected

Storage Channels:
2 Active

Last Upload:
Success

Last Telegram Error:
None
```

---

# 48. Testing Requirements

GLM must create tests for:

### Authentication

* Valid login
* Invalid login
* Session expiration
* Logout

### Upload

* Valid image
* Invalid MIME
* Oversized file
* Telegram failure
* Database failure

### URLs

* Valid URL
* Invalid ID
* Deleted file
* Missing Telegram file

### Channels

* Add channel
* Remove registration
* Invalid channel
* Connection failure

### Security

* Unauthenticated upload
* Unauthorized delete
* Direct API abuse
* Secret exposure

---

# 49. Acceptance Criteria

Project is considered V1 complete when:

### Authentication

* [ ] Admin can login.
* [ ] Unauthenticated users cannot access dashboard.
* [ ] Logout works.

### Telegram

* [ ] Telegram account can be connected.
* [ ] Session persists securely.
* [ ] Telegram connection status is visible.

### Channels

* [ ] User can register a private storage channel.
* [ ] Multiple channels are supported.
* [ ] User can select a destination during upload.

### Upload

* [ ] User can upload an image.
* [ ] Image reaches selected Telegram storage channel.
* [ ] Upload failures are handled gracefully.
* [ ] Metadata is saved.

### Public URL

* [ ] Unique public URL is generated.
* [ ] URL works without dashboard login.
* [ ] URL displays correct image.
* [ ] URL remains stable while file is active.

### Management

* [ ] Files can be listed.
* [ ] Files can be searched.
* [ ] URL can be copied.
* [ ] Files can be deleted.

### GrowPlants

* [ ] Generated URL can be stored in GrowPlants Admin.
* [ ] GrowPlants website can load the image.
* [ ] Multiple product images work.

---

# 50. Non-Functional Requirements

### Security

High priority.

### Performance

Image delivery should be optimized with caching.

### Reliability

Telegram/API failures must not crash the entire dashboard.

### Maintainability

Services should be separated:

```text
AuthService
TelegramService
FileService
StorageChannelService
UrlService
CacheService
```

### Scalability

Architecture should support:

```text
1 channel
→
10 channels
→
multiple storage destinations
```

without redesigning the entire application.

---

# 51. Recommended Project Structure

GLM should follow a modular architecture similar to:

```text
src/
├── app/
│   ├── login/
│   ├── dashboard/
│   ├── files/
│   ├── upload/
│   ├── channels/
│   └── settings/
│
├── api/
│   ├── auth/
│   ├── files/
│   ├── channels/
│   └── public/
│
├── components/
│   ├── dashboard/
│   ├── files/
│   ├── upload/
│   └── channels/
│
├── services/
│   ├── auth/
│   ├── telegram/
│   ├── storage/
│   ├── files/
│   ├── cache/
│   └── url/
│
├── database/
│
├── middleware/
│
└── utils/
```

Exact framework-specific structure can be adapted.

---

# 52. Development Phases

## Phase 1: Foundation

* Project initialization
* Authentication
* Database
* Dashboard shell
* Environment configuration

## Phase 2: Telegram

* Telegram authentication
* Session management
* Connection status
* Storage channel integration

## Phase 3: File Upload

* Upload UI
* Validation
* Telegram upload
* Metadata storage

## Phase 4: Stable URLs

* Public ID
* Public image endpoint
* URL generation
* Image delivery

## Phase 5: File Management

* File list
* Search
* Delete
* Copy URL
* Preview

## Phase 6: Channels

* Multiple destinations
* Channel selection
* Channel management

## Phase 7: Performance

* Caching
* Image delivery optimization
* Rate limiting

## Phase 8: Security & Testing

* Security audit
* API testing
* Failure testing
* Production testing

## Phase 9: Deployment

* Production configuration
* Secrets
* Domain
* HTTPS
* Monitoring

---

# 53. GLM 5.3 Development Rules

GLM ko project build karte waqt ye rules follow karne honge:

### Rule 1

**Do not implement the whole project blindly in one shot.**

Development phases mein kaam kare.

### Rule 2

Har phase ke baad:

```text
Build
→
Lint
→
Type Check
→
Tests
→
Fix
→
Continue
```

### Rule 3

Existing GrowPlants Admin Panel ke code ko unnecessarily modify na kare.

Storage system initially **independent application** rahega.

### Rule 4

Secrets source code mein hard-code na kare.

### Rule 5

Telegram integration ko ek dedicated service/module mein isolate kare.

### Rule 6

Raw Telegram URLs ko public database/API response ka canonical URL na banaye.

### Rule 7

Every public file URL must map through `publicId`.

### Rule 8

Destructive operations require confirmation.

### Rule 9

Errors user-friendly hon, but detailed server errors logs mein available hon.

### Rule 10

Production deployment se pehle security and failure testing mandatory ho.

---

# 54. Critical Technical Investigation Before Coding

GLM ko implementation se **pehle** verify karna hoga:

1. Personal Telegram account ke liye selected client/API approach.
2. Private channel mein programmatically media upload.
3. Telegram file retrieval mechanism.
4. Current Telegram file-size/API limitations.
5. Session persistence.
6. Telegram terms/policies applicable to this use.
7. Hosting environment mein persistent Telegram session support.
8. Caching strategy.
9. Public image streaming performance.

**In points ko assume nahi karna hai.** Current Telegram documentation/API behavior ko verify karke architecture lock karna hai.

---

# 55. Definition of Done

Project tab complete maana jayega jab:

```text
Admin Login
      ↓
Telegram Connected
      ↓
Storage Channel Registered
      ↓
Image Uploaded
      ↓
Image Stored in Telegram
      ↓
Metadata Saved
      ↓
Stable URL Generated
      ↓
URL Opens Publicly
      ↓
URL Added to GrowPlants
      ↓
GrowPlants Website Displays Image
```

Aur saath mein:

```text
Delete
Search
Multiple Channels
Security
Caching
Error Handling
Testing
Production Deployment
```

sab successfully work karein.

---

# 56. Final Product Vision

Ultimately system kuch aisa feel hona chahiye:

```text
             MY STORAGE
                 │
       ┌─────────┴─────────┐
       │                   │
 GrowPlants             Personal
 Storage                 Photos
       │                   │
       ▼                   ▼
   Telegram              Telegram
   Channel                Channel
       │                   │
       └─────────┬─────────┘
                 │
             Dashboard
                 │
        ┌────────┴────────┐
        │                 │
     Upload            Manage
        │                 │
        └────────┬────────┘
                 ▼
          Stable Public URL
                 │
                 ▼
          GrowPlants Website
```

**Sabse important architectural goal:** Telegram ko user ke liye invisible storage backend rakhna hai. User ka actual experience ek normal private image-hosting/storage platform jaisa hona chahiye.

