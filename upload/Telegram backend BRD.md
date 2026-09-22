
# BRD: Telegram-Backed Personal & Image Storage System

**Document Version:** 1.0
**Status:** Initial Requirements
**Primary Purpose:** Private file storage + stable public image hosting
**Primary Storage:** User's Telegram account
**User:** Single owner/admin initially

---

## 1. Product Overview

System ek standalone private web application hoga jo user's Telegram account ko **storage backend** ke roop mein use karega.

User system ke dashboard se images upload/manage karega. Files Telegram ke designated private storage channels mein save hongi.

System har uploaded image ke liye ek **stable public URL** generate karega.

Example:

```text
Upload
   ↓
Storage Dashboard
   ↓
Telegram Storage Channel
   ↓
File Mapping
   ↓
Stable Public URL
   ↓
GrowPlants Admin Panel
   ↓
GrowPlants Website
```

---

# 2. Core Objectives

System ke primary objectives:

1. Images ko Telegram-backed storage mein save karna.
2. Telegram ko directly expose kiye bina files manage karna.
3. Har image ke liye stable public URL provide karna.
4. URL ko GrowPlants Admin Panel mein use kar pana.
5. Website par images reliably load karwana.
6. Multiple Telegram storage channels ko support karna.
7. Personal aur project-related files ko separate rakhna.
8. Storage management ko simple dashboard se control karna.

---

# 3. Primary Use Cases

## Use Case A: GrowPlants Images

User:

```text
Storage Dashboard
→ Upload image
→ GrowPlants Storage select
→ Upload
→ Copy URL
```

Example:

```text
https://storage.example.com/i/gp_8x72ka91
```

Then:

```text
GrowPlants Admin
→ Product
→ Image URL
→ Paste
→ Save
```

Website:

```text
Customer
→ Product page
→ Image URL
→ Storage System
→ Image
```

---

## Use Case B: Personal Images

User future mein ek separate Telegram storage channel bana sakta hai:

```text
📸 Personal Photos
```

Dashboard mein us channel ko add/register karega.

Then:

```text
Upload
→ Personal Photos
→ Telegram
```

Personal files GrowPlants storage se completely separate rahengi.

---

# 4. Storage Destination System

Dashboard mein **Storage Destinations** ka concept hoga.

Example:

```text
Storage Destinations

🌿 GrowPlants Storage
Type: Private Channel
Status: Active

📸 Personal Photos
Type: Private Channel
Status: Active

📁 Documents
Type: Private Channel
Status: Active
```

User upload karte waqt destination select karega:

```text
Storage:

[ 🌿 GrowPlants Storage ▼ ]
```

---

# 5. Channel Management

System ko ek single Telegram channel ke saath hard-code nahi kiya jayega.

User multiple storage channels register kar sakega.

### Example

```text
Telegram Account
│
├── 🌿 GrowPlants Storage
├── 📸 Personal Photos
└── 📁 Documents
```

Har channel ka unique identifier system mein save hoga.

System ko pata hoga:

```text
File A → GrowPlants Storage
File B → Personal Photos
File C → Documents
```

---

# 6. Upload Requirements

Dashboard par:

```text
+ Upload
```

User:

1. File select karega.
2. Storage destination select karega.
3. Upload start karega.
4. Progress dekhega.
5. Upload completion receive karega.
6. Generated public URL copy kar sakega.

### Upload Result

```text
Upload Successful ✓

File:
money-plant.jpg

Storage:
GrowPlants Storage

Public URL:
https://storage.example.com/i/a8f72k91

[Copy Link]
```

---

# 7. File Management

Dashboard mein uploaded files ki list hogi.

Example:

| File         | Storage    | Type  | Size   | Status | Action |
| ------------ | ---------- | ----- | ------ | ------ | ------ |
| money.jpg    | GrowPlants | Image | 1.2 MB | Active | Copy   |
| snake.jpg    | GrowPlants | Image | 850 KB | Active | Copy   |
| birthday.jpg | Personal   | Image | 2.4 MB | Active | Copy   |

Required actions:

* Preview
* Copy URL
* Delete
* Search
* Filter
* View details

---

# 8. Stable Public URL

System Telegram ka raw URL directly user ko nahi dega.

Instead:

```text
https://storage.example.com/i/{publicId}
```

Example:

```text
https://storage.example.com/i/gp_8x72ka91
```

`publicId` unique hoga.

### Requirement

Same file ke liye generated public URL **stable rehna chahiye**, jab tak file intentionally delete nahi ki jaati.

---

# 9. Public vs Private Access

### Public

Sirf generated image URL:

```text
https://storage.example.com/i/gp_8x72ka91
```

Customer browser se access kar sakta hai.

### Private

Ye sab protected rahenge:

* Dashboard
* Telegram credentials
* Telegram session
* Storage configuration
* Channel identifiers where appropriate
* Database
* Upload/delete APIs

Customer ko Telegram account/channel ka access nahi milega.

---

# 10. GrowPlants Integration

GrowPlants Admin Panel mein existing product image system ke saath integration hoga.

Example:

```text
Product
├── Image 1
│   └── https://storage.../i/abc
├── Image 2
│   └── https://storage.../i/def
└── Image 3
    └── https://storage.../i/xyz
```

Website normal `<img>`/image rendering ke through URL consume karegi.

---

# 11. File Identification

Har uploaded file ka internal record maintain hoga.

Conceptually:

```text
File
│
├── Internal ID
├── Public ID
├── Original Filename
├── File Type
├── File Size
├── Telegram Storage Channel
├── Telegram File/Message Reference
├── Public URL
├── Created Date
└── Status
```

Is mapping ki wajah se system ko pata rahega ki public URL kis Telegram file se connected hai.

---

# 12. Delete Behavior

Dashboard:

```text
File
→ Delete
```

System:

```text
Public URL
       ↓
Disabled/404

Database record
       ↓
Deleted/marked deleted

Telegram file
       ↓
Deleted according to configured behavior
```

Important requirement:

**Delete karne ke baad us URL ko active image nahi serve karna chahiye.**

---

# 13. Dashboard Requirements

### Dashboard

```text
Storage Overview
```

Show:

* Total files
* Images
* Active storage destinations
* Recent uploads
* Failed uploads
* Storage/channel status

### Navigation

```text
Dashboard
Files
Upload
Storage Channels
Settings
```

---

# 14. Storage Channel Management

### Add Channel

```text
+ Add Storage Channel
```

User channel select/register karega.

Information:

```text
Channel Name
Channel ID
Storage Purpose
Status
```

Example:

```text
Name:
🌿 GrowPlants Storage

Purpose:
Website Images

Status:
● Connected
```

---

# 15. Future Channel Support

System future expansion ke liye designed hoga.

Example:

```text
Today:

GrowPlants Storage

Future:

GrowPlants Storage
Personal Photos
Videos
Documents
Backups
```

User ko new channel add karne ke liye existing system rebuild nahi karna padega.

---

# 16. Authentication

Dashboard private hoga.

Initial requirement:

```text
Login
   ↓
Dashboard
```

Only authorized user storage manage kar sakega.

Authentication implementation technology later decide hogi.

---

# 17. Security Requirements

System must:

* Telegram credentials browser mein expose na kare.
* Telegram session client-side store na kare.
* Unauthorized upload prevent kare.
* Unauthorized delete prevent kare.
* Storage management APIs protected rakhe.
* Public URL endpoint ko only required file data serve karna chahiye.
* Admin credentials securely store kare.

---

# 18. Performance Requirements

GrowPlants website ke image loading ko unnecessary slow nahi karna chahiye.

Architecture future mein caching/CDN support kar sake.

Ideal flow:

```text
First Request
Browser
 ↓
Storage Server
 ↓
Telegram
 ↓
Cache

Future Requests
Browser
 ↓
Cache
 ↓
Image
```

---

# 19. V1 Scope

### V1 mein include hoga:

✅ Private dashboard
✅ Login
✅ Telegram account connection
✅ Private storage channel registration
✅ Multiple storage channels
✅ Image upload
✅ Image preview
✅ File listing
✅ Stable public URL
✅ Copy URL
✅ Delete
✅ Search/filter
✅ GrowPlants image URL usage
✅ Basic caching architecture
✅ Storage/channel status

---

# 20. V1 mein intentionally exclude

Abhi unnecessary complexity avoid karenge:

❌ Full personal cloud drive
❌ Advanced folder hierarchy
❌ Video management
❌ Document management
❌ Public file sharing dashboard
❌ Multi-user/team accounts
❌ Advanced permissions
❌ File editing
❌ Photo editing
❌ Mobile app

Ye features future versions mein add kiye ja sakte hain.

---

# 21. Future Roadmap

### V2

* Videos
* Documents
* Drag & drop
* Folders
* Bulk upload
* Bulk delete
* Better search
* File sorting

### V3

* Multiple Telegram accounts
* Advanced permissions
* Storage analytics
* Automatic image optimization
* Automatic thumbnails
* CDN integration
* API access

---

# 22. Most Important Product Rule

System ka fundamental relationship:

> **Telegram is the storage layer, not the public-facing file URL layer.**

Aur:

> **Our Storage System is the management + stable URL layer.**

Isse GrowPlants ko Telegram ke internal file URLs par directly depend nahi karna padega.

---

# 23. Final Requirement in One Sentence

**"Ek private web-based storage dashboard banana hai jo user's Telegram account ke dedicated private storage channels mein images store kare, multiple channels manage kare, har image ko stable public URL de, aur un URLs ko GrowPlants Admin Panel mein use karke website par images serve karwaye."**
