import {v2 as cloudinary} from "cloudinary";
import fs from "fs";



if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
    console.error("Cloudinary environment variables are not set properly:");
    console.error("CLOUDINARY_CLOUD_NAME:", process.env.CLOUDINARY_CLOUD_NAME ? "Set" : "Missing");
    console.error("CLOUDINARY_API_KEY:", process.env.CLOUDINARY_API_KEY ? "Set" : "Missing");
    console.error("CLOUDINARY_API_SECRET:", process.env.CLOUDINARY_API_SECRET ? "Set" : "Missing");
}

// cloudinary.config({
//     cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
//     api_key:process.env.CLOUDINARY_API_KEY,
//     api_secret:process.env.CLOUDINARY_API_SECRET
// })


const uploadOnCloudinary = async (localFilePath) => {
    try {
        if(!localFilePath) return null;


        // Configure Cloudinary when the function is called, not when module is imported
        cloudinary.config({
            cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
            api_key: process.env.CLOUDINARY_API_KEY,
            api_secret: process.env.CLOUDINARY_API_SECRET
        });

        // Check if Cloudinary is configured properly
        const config = cloudinary.config();
        if (!config.cloud_name || !config.api_key || !config.api_secret) {
            throw new Error("Cloudinary not configured properly. Missing credentials.");
        }

        //Check if cloudinary is configured properly
        if(!cloudinary.config().cloud_name || !cloudinary.config().api_key || !cloudinary.config().api_secret){
            throw new Error("Cloudinary not configured properly. Missing credentials.")
        }

        //upload the file on cloudinary
        const response = await cloudinary.uploader.upload(localFilePath, {
            resource_type: "auto"
        })

        // file has been uploaded successfully
        // console.log("File is uploaded on cloudinary",response.url);
        fs.unlinkSync(localFilePath)
        return response;
        
    } catch (error) {
        console.log("Cloudinary upload error:", error);
        
        if (localFilePath) {
            fs.unlinkSync(localFilePath) //remove the locally saved temporary file as the upload operation got failed
        }
        
        return null;
    }
}



export {uploadOnCloudinary};