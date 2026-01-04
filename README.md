# 📖 Ink2Image Backend
### *AI-Powered Multimodal Storytelling Engine*

[![Node.js](https://img.shields.io/badge/Node.js-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![MongoDB](https://img.shields.io/badge/MongoDB-47A248?logo=mongodb&logoColor=white)](https://www.mongodb.com/)
[![Gemini AI](https://img.shields.io/badge/Gemini%20AI-8E75B2?logo=google-gemini&logoColor=white)](https://ai.google.dev/)
[![Google Cloud](https://img.shields.io/badge/Google%20Cloud-4285F4?logo=google-cloud&logoColor=white)](https://cloud.google.com/)

**Ink2Image** is a specialized backend engine designed to transform long-form literature into visually consistent, illustrated experiences. Using a multi-pass LLM pipeline, it analyzes story context, extracts stylistic parameters, and generates cinematically consistent image prompts for automated book illustration.



---

## 🌟 Technical Highlights

* **Recursive Continuity Engine:** Solves the "context amnesia" problem by implementing a recursive summarization pass that injects plot-aware recaps into sequential image prompts.
* **Global Style Synchronization:** Extracts a comprehensive "Global Style Guide" from the initial chapters to ensure character and art-style consistency across hundreds of generated images.
* **Cost-Optimized On-Demand Buffering:** Implemented a range-based generation strategy to prevent API waste, only producing assets as the user progresses through the book.
* **Hybrid Cloud Infrastructure:** Orchestrates between **Google Cloud Storage (GCS)** for high-performance serving and **OAuth 2.0 Google Drive integration** for personal quota management.

---

## 🏗️ System Architecture

The backend operates on a **Three-Pass Architecture**:

1.  **Analysis Pass (Pass 1):** Ingests the first 10 pages to establish Art Style, Character Sheets, and Setting Vibe.
2.  **Prompt Engineering Pass (Pass 2):** Processes every page to create highly descriptive, cinematography-focused image prompts using plot-recap injection.
3.  **Visualization Pass (Pass 3):** Asynchronously generates images using **Imagen 3 (Fast)** and persists them to cloud storage with public access permissions.

---

## 🛠️ Tech Stack

* **Runtime:** Node.js & Express.js
* **Database:** MongoDB (Mongoose ODM)
* **AI Orchestration:** Google Gemini 1.5 Flash & Imagen 3
* **Cloud Infrastructure:** Google Cloud Platform (Vertex AI, GCS, OAuth 2.0)
* **Storage APIs:** Google Drive API v3 & Google Cloud Storage SDK

---

## 🚀 Getting Started

### Prerequisites
* Node.js v18+
* MongoDB Instance
* Google Cloud Project with Gemini & Cloud Storage APIs enabled

### Installation
1. Clone the repository:
   ```bash
   git clone https://github.com/sahaarnav3/Ink2Image.git
   cd Ink2Image
2. Install dependencies:
    ```bash
    npm install
3. Configure `.env`:
    ```bash
    PORT=5000
    MONGO_URI=your_mongodb_uri
    GEMINI_API_KEY=your_api_key

    # GCS Configuration
    GCS_BUCKET_NAME=your_bucket_name
    GOOGLE_APPLICATION_CREDENTIALS=./google-drive-key.json

    # OAuth Drive Configuration
    GOOGLE_CLIENT_ID=your_client_id
    GOOGLE_CLIENT_SECRET=your_client_secret
    GOOGLE_REFRESH_TOKEN=your_refresh_token
    GOOGLE_DRIVE_FOLDER_ID=your_folder_id
---

## 📡 API Endpoints

### Book Management
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/books/upload` | Upload PDF and parse into individual page documents. |
| `POST` | `/api/books/:id/analyze` | **Pass 1:** Extract the Global Style Guide (Characters, Art Style, Setting) from the first 10 pages. |

### AI Generation
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/:id/generate-prompts` | **Pass 2:** Batch generate all cinematic image prompts using the Recursive Continuity Engine. |
| `POST` | `/:id/generate-images-range` | **Pass 3:** Trigger high-speed image generation and cloud upload for a specific page buffer (e.g., Pages 1-10). |

---

## 🛡️ Cost Control & Safety
To ensure project sustainability and prevent unintended cloud billing, the following safeguards are implemented:

* **Usage Buffering:** Images are never generated for the entire book at once. The "Look-Ahead" strategy ensures only the next 10 pages are processed, preventing waste if a user stops reading.
* **API Quotas:** Integrated rate-limiting with 2–5 second delays between requests to stay strictly within the Google Gemini Free Tier (10-15 RPM) and prevent `429 Too Many Requests` errors.
* **Idempotent Retries:** Custom `runWithRetry` utility logic handles transient 503/504 API errors automatically without duplicate processing or redundant billing.
* **Storage Management:** Implements automatic cleanup of temporary buffers and direct cloud streaming to minimize local server disk usage.

---

## 📁 Repository Structure
```text
server/
├── models/         # Mongoose schemas (Book, Page)
├── routes/         # Express routes (Book/AI/Image logic)
├── utils/          # AI Services & Cloud Storage handlers
├── uploads/        # Temporary PDF storage
└── .env            # Environment secrets (Protected)