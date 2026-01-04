const { GoogleGenAI, Type } = require("@google/genai");
require("dotenv").config();
const { google } = require("googleapis");
const { Storage } = require('@google-cloud/storage');
const fs = require("fs");
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const genAI = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

//Google Drive Client Setup (Service Account wont work)
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  "https://developers.google.com/oauthplayground"
);

// Set the refresh token so the client can automatically get new access tokens
oauth2Client.setCredentials({
  refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
});

//Initializing GCS client using Service Account Key
const storage = new Storage({
  projectId: 'gen-lang-client-0250576987',
  keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS
})
const bucketName = process.env.GCS_BUCKET_NAME;

const drive = google.drive({ version: "v3", auth: oauth2Client });

//To call the api atleast 5 times before sending server issue to the client.
const runWithRetry = async (fn, apiName = "API", retries = 5, delay = 1000) => {
  try {
    return await fn();
  } catch (error) {
    if (
      retries > 0 &&
      (error.status == 503 || error.status == 429 || error.status >= 400)
    ) {
      console.warn(
        `⚠️ ${apiName} is either Overloaded or Unavailable. Retrying in ${delay}ms... (${retries} attempts left)`
      );

      //1. Wait for delay
      await new Promise((resolve) => setTimeout(resolve, delay));
      return runWithRetry(fn, apiName, retries - 1, delay + 1000);
    } else {
      throw error;
    }
  }
};

//Main Function
const generateAndUploadImage = async (prompt, bookId, pageNumber) => {
  const mainApi = async () => {
    const filePath = "generatedImage.png";
    console.log("\n🖼️ Generating image for Page " + pageNumber + "...");

    // Below Logic will be used to generate image using Gemini 'Nano Banana' and storing it in a file names generatedImage.png
    // const responseUsingNanoBanana = await genAI.models.generateContent({
    //   // model: "gemini-3-pro-image-preview",
    //   model: "gemini-2.5-flash-image",
    //   contents: prompt,
    // });
    // for (const part of responseUsingNanoBanana.candidates[0].content.parts) {
    //   if (part.inlineData) {
    //     const buffer = Buffer.from(part.inlineData.data, "base64");
    //     console.log("\n Image Generated. Uploading to google drive...");
    //     fs.writeFileSync(filePath, buffer);
    //   }
    // }

    // Below Logic will be used to generate image using Gemini 'Imagen' and storing it in a file names generatedImage.png
    const responseUsingImagen = await genAI.models.generateImages({
      model: "imagen-4.0-generate-001",
      prompt: prompt,
      config: {
        numberOfImages: 1,
      },
    });
    for (const generatedImage of responseUsingImagen.generatedImages) {
      if (generatedImage.image.imageBytes) {
        const buffer = Buffer.from(generatedImage.image.imageBytes, "base64");
        console.log("\nImage Generated.");
        fs.writeFileSync(filePath, buffer);
      } else
        throw new Error(
          "Image Generation error from IMAGEN. Please Try Again."
        );
    }

    // console.log("Uploading Image to Google Drive...");
    // const imageLink = await uploadImageToDrive(filePath, bookId, pageNumber);

    console.log("Uploading Image to Google Cloud Storage...");
    const imageLink = await uploadImageToCloud(filePath, bookId, pageNumber);

    //Deleting image from local if it is successfully saved in drive
    fs.unlinkSync(filePath);
    return imageLink;
  };
  try {
    return await runWithRetry(mainApi, "Gemini");
  } catch (error) {
    console.error(error);
    throw new Error(
      "Failed to generate Image from 'Image Prompt' after multiple attempts."
    );
  }
};

//Function to upload image to google drive with retries
const uploadImageToDrive = async (filePath, bookId, pageNumber) => {
  const mainApi = async () => {
    //checking if the image is created or not;
    if (fs.existsSync(filePath)) {
      const stats = fs.statSync(filePath);
      if (stats.size <= 0) throw new Error("The image created is empty.");
    } else throw new Error("The image file doesn't exist.");

    //Uploading the image generated to google drive
    const fileMetaData = {
      name: `book_${bookId}_page_${pageNumber}.png`,
      parents: [process.env.GOOGLE_DRIVE_FOLDER_ID],
    };
    const media = {
      mimeType: "image/png",
      body: fs.createReadStream("generatedImage.png"),
    };
    const driveResponse = await drive.files.create({
      resource: fileMetaData,
      media: media,
      supportsAllDrives: true,
      fields: `id, webContentLink, webViewLink`, //Requesting the public links.
    });
    const fileId = driveResponse.data.id;
    console.log("\nUpload To drive successful! File ID:", fileId);

    //Making the files public
    await drive.permissions.create({
      fileId: fileId,
      requestBody: {
        role: "reader",
        type: "anyone",
      },
    });

    //returning the webcontent link (to be stored in Page Document)
    return driveResponse.data.webContentLink;
  };
  try {
    return await runWithRetry(mainApi, "Google Drive");
  } catch (error) {
    console.error("Google Drive Upload Error after retries :-", error);
    throw new Error(
      "Failed to Upload Image to Google Drive after multiple attempts."
    );
  }
};

//Function to upload image to google cloud storage GCS with retries
const uploadImageToCloud = async (filePath, bookId, pageNumber) => {
  const mainApi = async () => {
    const fileName = `book_${bookId}_page_${pageNumber}.png`;
    await storage.bucket(bucketName).upload(filePath, {
      destination: fileName
    });
    console.log(`${filePath} uploaded to ${bucketName}/${fileName}`);

    //Making file publicly accessible 
    await storage.bucket(bucketName).file(fileName).makePublic();
    const publicUrl = `https://storage.googleapis.com/${bucketName}/${fileName}`;
    console.log("GCS Generated Public URL :-", publicUrl);
    return publicUrl;
  };
  try {
    return await runWithRetry(mainApi, "Google Cloud Storage");
  } catch (error) {
    console.error("Google Cloud Storage Upload Error after retries :-", error);
    throw new Error(
      "Failed to Upload Image to Google Cloud Storage after multiple attempts."
    );
  }
};

module.exports = { generateAndUploadImage };
