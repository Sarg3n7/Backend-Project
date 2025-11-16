import { asyncHandler } from "../utils/asyncHandler.js";
import {ApiError} from "../utils/ApiError.js";
import {User} from "../models/user.model.js";
import {deleteFromCloudinary, uploadOnCloudinary} from "../utils/cloudinary.js";
import {ApiResponse} from "../utils/ApiResponse.js";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";


const generateAccessAndRefreshTokens = async(userId) =>{
    try {
        const user = await User.findById(userId)
        const accessToken = user.generateAccessToken()
        const refreshToken = user.generateRefreshToken()
        user.refreshToken = refreshToken
        await user.save({validateBeforeSave: false})

        return {accessToken, refreshToken}



    } catch (error) {
        throw new ApiError(500, "Somethin went wrong while generating tokens")
    }
}

const registerUser = asyncHandler(async (req, res) => {
    // get user details from frontend
    const{fullname, email, username, password} = req.body
    // console.log("email:", email);
    // console.log("req.files:", req.files); // <-- Add this line

    // validation - checking if not empty

    // if (fullname === ""){
    //     throw new ApiError(400, "Fullname is required")
    // }

    if ([fullname, email, username, password].some((field)=> field?.trim() === "")) {
        throw new ApiError(400, "All fields are required")
    }


    // check if user already exists: username, email
    const existedUser = await User.findOne({
        $or: [{ username }, { email }]
    })

    if (existedUser) {
        throw new ApiError(409, "User with email or username already exists")
    }


    // check for images, check for avatar
    const avatarLocalPath = req.files?.avatar[0]?.path;
    // const coverImageLocalPath = req.files?.coverImage[0]?.path;

    let coverImageLocalPath
    if (req.files && Array.isArray(req.files.coverImage) && req.files.coverImage.length > 0) {
        coverImageLocalPath = req.files.coverImage[0].path
    }

    if (!avatarLocalPath) {
        throw new ApiError(400, "Avatar image is required")
    }


    // upload them to cloudinary, avatar
    const avatar = await uploadOnCloudinary(avatarLocalPath)
    const coverImage = await uploadOnCloudinary(coverImageLocalPath)
    if(!avatar){
        throw new ApiError(400, "Failed to upload avatar image to cloudinary.")
    }

    // create user object - create entry in DB
    const user = await User.create({
        fullname,
        avatar: avatar.url,
        coverImage: coverImage?.url || "",
        email,
        password,
        username: username.toLowerCase()
    })

     
    // remove password and refresh token field from response
    const createdUser = await User.findById(user._id).select(
        "-password -refreshToken"
    )

    // check for user creation
    if(!createdUser){
        throw new ApiError(500, "User registration failed. Please try again later.")
    }

    //return response
    return res.status(201).json(
        new ApiResponse(200, createdUser, "User registered successfully")
    )
     

})

const loginUser = asyncHandler(async (req, res) => {
    // Get req body from data
    const {email, username, password} = req.body
    console.log(email);
    

    
    // Username or email
    if (!username && !email) {
        throw new ApiError(400, "Username or email is required")
    }

    // Here is an alternative of above code based on logic above:
    // if (!(username || email)) {
    //     throw new ApiError(400, "username or email is required")
        
    // }


    // find the user
    const user = await User.findOne({
        $or: [{username}, {email}]
    })

    if(!user){
        throw new ApiError(404, "User not found")
    }


    // password check
    const isPasswordValid = await user.isPasswordCorrect(password)
    if (!isPasswordValid) {
        throw new ApiError(401, "Invalid password")
    }


    // access token and refresh token -> send to user
    const {accessToken, refreshToken} = await generateAccessAndRefreshTokens(user._id)


    // sends cookies to the logged in user
    const loggedInUser = await User.findById(user._id).select("-password -refreshToken")

    const options ={
        httpOnly: true,
        secure: true,
    }

    return res.status(200)
    .cookie("accessToken", accessToken, options)
    .cookie("refreshToken", refreshToken, options)

    // response for successful login
    .json(
        new ApiResponse(200,
            {
                user: loggedInUser, accessToken, refreshToken
            },
            "User logged in successfully"
        )
    )

    
})

const logoutUser = asyncHandler(async(req, res) =>{
    //find the user
    await User.findByIdAndUpdate(
        req.user._id,
        {
            $set: {
                refreshToken: undefined
            }
        },
        {
            new: true
        }
    )

    const options ={
        httpOnly: true,
        secure: true,
    }
    return res
    .status(200)
    .clearCookie("accessToken", options)
    .clearCookie("refreshToken", options)
    .json(new ApiResponse(200, {}, "User logged out successfully"))
})


const refreshAccessToken = asyncHandler(async(req, res) => {
    const incomingRefreshToken = req.cookies.refreshToken || req.body.refreshToken

    if(!incomingRefreshToken){
        throw new ApiError(401, "Refresh token is required")
    }


    try {
        const decodedToken = jwt.verify(
            incomingRefreshToken,
            process.env.REFRESH_TOKEN_SECRET
        )
    
        const user = await User.findById(decodedToken?._id)
        if(!user){
            throw new ApiError(401, "Invalid refresh token.")
        }
    
        if (incomingRefreshToken !== user?.refreshToken) {
            throw new ApiError(401, "Refresh token is expired or used.")
        }
    
        const options ={
            httpOnly: true,
            secure: true
        }
    
        const{accessToken, newRefreshToken} = await generateAccessAndRefreshTokens(user._id)
    
        return res
        .status(200)
        .cookie("accessToken", accessToken, options)
        .cookie("refreshToken", newRefreshToken, options)
        .json(
            new ApiResponse(
                200,
                {accessToken, refreshToken: newRefreshToken},
                "Access token refreshed successfully"
            )
        )
    } catch (error) {
        throw new ApiError(401, error?.message || "Invalid refresh token")
    }

})

//This method allows a user to change their current password.
const changeCurrentPassword = asyncHandler(async(req, res) =>{
    const{oldPassword, newPassword} = req.body

    
    const user = await User.findById(req.user?._id)
    const isPasswordCorrect = await user.isPasswordCorrect(oldPassword)


    if (!isPasswordCorrect) {
        throw new ApiError(400, "Invalid old password")
    }

    user.password = newPassword
    await user.save({validateBeforeSave: false})

    return res
    .status(200)
    .json(new ApiResponse(200, {}, "Password changed successfully"))
})


const getCurrentUser = asyncHandler(async(req, res) =>{
    return res
    .status(200)
    .json(new ApiResponse(
        200, 
        req.user, 
        "Current user fetched successfully"
    ))
})

const updateAccountDetails = asyncHandler(async(req, res) =>{
    const {fullname, email} =req.body
    if(!fullname || !email){
        throw new ApiError(400, "All fields are required")
    }
    const user = await User.findByIdAndUpdate(
        req.user?._id,
        {
            $set:{
                fullname,
                email
            }
        },
        {new: true}
    ).select("-password")

    return res
    .status(200)
    .json(new ApiResponse(200, user, "Account details updated successfully"))
})

//TODO: delete the previous avatar from cloudinary
const updateUserAvatar = asyncHandler(async(req, res) =>{
    const avatarLocalPath = req.file?.path

    if (!avatarLocalPath) {
        throw new ApiError(400,"Avatar image is required")
    }

    const avatar = await uploadOnCloudinary(avatarLocalPath)

    if(!avatar.url){
        throw new ApiError(400, "Error while uploading avatar image to cloudinary")
    }

    //get old avatar before updating
    const currentUser = await User.findById(req.user?._id).select("avatar")
    const oldAvatarUrl = currentUser?.avatar

    const user = await User.findByIdAndUpdate(
        req.user?._id,
        {
            $set:{
                avatar: avatar.url
            }
        },
        {new: true}
    ).select("-password")

    //delete the old avatar after successful update
    try {
        if (oldAvatarUrl && oldAvatarUrl !== avatar.url) {
            await deleteFromCloudinary(oldAvatarUrl)
        }
    } catch (error) {
        console.error("Failed to delete old avatar from Cloudinary", error);
    }

    return res
    .status(200)
    .json(new ApiResponse(200, user, "Avatar updated successfully"))
})

const deleteUserAvatar = asyncHandler(async(req, res) => {
    const user = await User.findById(req.user?._id)
    
    if (!user.avatar) {
        throw new ApiError(400, "No avatar to delete")
    }

    // await oldAvatarImageToBeDeleted(user.avatar)
    try {
        await deleteFromCloudinary(user.avatar)
    } catch (error) {
        console.error("Error deleting avatar from cloudinary", error);
    }
    const updatedUser = await User.findByIdAndUpdate(
        req.user?._id,
        {
            $set:{
                avatar: ""
            }
        },
        {new: true}
    ).select("-password")

    return res
    .status(200)
    .json(new ApiResponse(200, updatedUser, "Avatar deleted successfully"))
})


const updateUserCoverImage = asyncHandler(async(req, res) =>{
    const coverImageLocalPath = req.file?.path

    if (!coverImageLocalPath) {
        throw new ApiError(400, "Cover image is required")
    }

    const coverImage = await uploadOnCloudinary(coverImageLocalPath)

    if (!coverImage.url) {
        throw new ApiError(400, "Error while uploading cover image to cloudianary")
    }

    const user = await User.findByIdAndUpdate(
        req.user?._id,
        {
            $set:{
                coverImage: coverImage.url
            }
        },
        {new:true}
    ).select("-password")

    return res
    .status(200)
    .json(new ApiResponse(200, user, "Cover image updated successfully"))
})


const getUserChannelProfile = asyncHandler(async(req, res) =>{
    const{username} = req.params

    if (!username?.trim()) {
        throw new ApiError(400,"Usernam is required")
    }

    const channel = await User.aggregate([
        {
            $match:{
                username: username?.toLowerCase()
            }
        },
        {
            $lookup:{
                from: "subscriptions",
                localField: "_id",
                foreignField:"channel",
                as: "subscribers"
            }
        },
        {
            $lookup:{
                from: "subscriptions",
                localField: "_id",
                foreignField: "subscriber",
                as: "subscribedTo"
            }
        },
        {
            $addFields:{
                subscribersCount:{
                    $size: "$subscribers"
                },
                channelsSubscribedToCount:{
                    $size: "$subscribedTo"
                },
                isSubscribed:{
                    $cond: {
                        if:{$in: [req.user?._id, "$subscribers.subscriber"]},
                        then: true,
                        else: false
                    }
                }
            }
        },
        {
            $project:{
                fullname: 1,
                username: 1,
                subscribersCount: 1,
                channelsSubscribedToCount: 1,
                isSubscribed: 1,
                avatar: 1,
                coverImage: 1,
                email: 1,
                createdAt: 1
            }
        }
    ])
    console.log(channel);
    
    if (!channel?.length) {
        throw new ApiError(404, "Channel not found")
    }

    return res
    .status(200)
    .json(
        new ApiResponse(
            200,
            channel[0],
            "User channel profile fetched successfully"
        )
    )
})


const getWatchHistory = asyncHandler(async(req, res) =>{
    const user = await User.aggregate([
        {
            $match:{
                _id: new mongoose.Types.ObjectId(req.user?._id)
            }
        },
        {
            $lookup:{
                from: "videos",
                localField: "watchHistory",
                foreignField: "_id",
                as: "watchHistory",
                pipeline:[
                    {
                        $lookup:{
                            from: "users",
                            localField: "owner",
                            foreignField: "_id",
                            as: "owner",
                            pipeline: [
                                {
                                    $project:{
                                        fullname: 1,
                                        username: 1,
                                        avatar: 1
                                    }
                                }
                            ]
                        }
                    },
                    {
                        $addFields:{
                            owner:{
                                $first: "$owner"
                            }
                        }
                    }
                ]
            }
        }
    ])

    return res
    .status(200)
    .json(
        new ApiResponse(
            200,
            user[0].watchHistory,
            "Watch history fetched successfully"
        )
    )
})


export {
    registerUser,
    loginUser,
    logoutUser,
    refreshAccessToken,
    changeCurrentPassword,
    getCurrentUser,
    updateAccountDetails,
    updateUserAvatar,
    updateUserCoverImage,
    deleteUserAvatar,
    getUserChannelProfile,
    getWatchHistory
}