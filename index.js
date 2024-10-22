import express from "express";
import nodemailer from "nodemailer";
import bodyParser from "body-parser";
import mysql from "mysql2";
import dotenv from "dotenv";
import fetch from "node-fetch";
import { OAuth2Client } from "google-auth-library";
import { google } from 'googleapis';
import session from 'express-session';  // Import express-session

dotenv.config();
const app = express();
const port = 3000;

// Configure session middleware
app.use(session({
    secret: 'your-secret-key',  // Change this to a secure key
    resave: false,
    saveUninitialized: true,
}));

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.set('view engine', 'ejs');
app.use(express.static("public"));

// Google OAuth setup
const googleClientId = process.env.CLIENT_ID;
const googleClientSecret = process.env.CLIENT_SRC;
const googleClient = new OAuth2Client(googleClientId);

// Redirect URI for OAuth
const redirectUri = "http://localhost:3000/auth/google/callback";



const isAuthenticated = (req, res, next) => {
    if (req.session && req.session.user) {
        return next();
    } else {
        res.redirect("/"); // Redirect to login page if not authenticated
    }
};
app.get("/", (req, res) => {
    res.render("index.ejs");
});
app.get("/about", (req, res) => {
    res.render("about.ejs");
});

app.get("/contact", (req, res) => {
    res.render("contact.ejs");
});

app.get("/note", isAuthenticated, (req, res) => {
    res.render("note.ejs");
});

app.get("/auth/google", (req, res) => {
    const scopes = ['https://www.googleapis.com/auth/userinfo.email','https://www.googleapis.com/auth/calendar', 'https://www.googleapis.com/auth/userinfo.profile','https://www.googleapis.com/auth/gmail.send'];
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${googleClientId}&redirect_uri=${redirectUri}&response_type=code&scope=${scopes.join(' ')}&access_type=offline`;
    res.redirect(authUrl);
});

// Google OAuth callback handler
app.get("/auth/google/callback", async (req, res) => {
    const code = req.query.code;

    try {
        const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({
                code: code,
                client_id: googleClientId,
                client_secret: googleClientSecret,
                redirect_uri: redirectUri,
                grant_type: 'authorization_code'
            })
        });

        const tokenData = await tokenResponse.json();
        const accessToken = tokenData.access_token;

       
        // Store access token and user email in session
        const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`
            }
        });

        const userInfo = await userInfoResponse.json();
 
        const emailVerified = userInfo.email_verified;

        if (emailVerified) {
            // Store user information in the session
            req.session.user = userInfo; 
            res.redirect("/note");  
        } else {
            res.status(401).send("Email not verified");
        }
    } catch (error) {
        console.error("Error during Google OAuth:", error);
        res.redirect("/");
    }
});

// Send email route
app.post("/send-email", async (req, res) => {
    const { name, email, message } = req.body;

    let transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.CUSTOME_EMAIL,
            pass: process.env.APP_PASS
        }
    });

    let mailOptions = {
        from:  process.env.EMAIL_USER,
        to: process.env.RECEIVER_EMAIL,
        subject: `New message from User`,
        text: message
    };

    try {
        const info = await transporter.sendMail(mailOptions);
        console.log("Email sent: " + info.response);
        res.send("Email has been sent successfully!");
        res.redirect("/contact");
    } catch (error) {
        console.error("Error sending email:", error);
        res.status(500).send("There was an error sending the email. Please try again later.");
    }
});

// Start server
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
