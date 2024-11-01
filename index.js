import express from "express";
import nodemailer from "nodemailer";
import bodyParser from "body-parser";
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
    secret: process.env.SECRET_KEY,  // Change this to a secure key
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

// Middleware to check if user is authenticated
const isAuthenticated = (req, res, next) => {
    if (req.session && req.session.user) {
        return next();
    } else {
        res.redirect("/"); // Redirect to login page if not authenticated
    }
};

// Routes
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
    const scopes = [
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/calendar',
        'https://www.googleapis.com/auth/userinfo.profile',
        'https://www.googleapis.com/auth/gmail.send'
    ];
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

        if (!accessToken) {
            throw new Error("Failed to retrieve access token.");
        }

        // Store tokenData in the session
        req.session.tokenData = tokenData;

        const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`
            }
        });

        const userInfo = await userInfoResponse.json();
        if (userInfo.email_verified) {
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
        from: process.env.CUSTOME_EMAIL,
        to: process.env.RECEIVER_EMAIL,
        subject: `New message from User`,
        text: message
    };

    try {
        await transporter.sendMail(mailOptions);
        res.send("Email has been sent successfully!");
    } catch (error) {
        console.error("Error sending email:", error);
        res.status(500).send("There was an error sending the email. Please try again later.");
    }
});

// Create event route
app.post("/create_event", isAuthenticated, async (req, res) => {
    const { description, publishToCalendar, summary, start, end, startTime, endTime, category } = req.body;

    if (publishToCalendar) {
        const accessToken = req.session.tokenData.access_token;

        // Create event object
        const event = {
            summary,
            description,
            start: {
                dateTime: new Date(`${start}T${startTime}`).toISOString(),
                timeZone: 'America/Los_Angeles', // Adjust time zone as needed
            },
            end: {
                dateTime: new Date(`${end}T${endTime}`).toISOString(),
                timeZone: 'America/Los_Angeles',
            },
            category,
        };

        try {
            const oAuth2Client = new google.auth.OAuth2();
            oAuth2Client.setCredentials({ access_token: accessToken });

            const calendar = google.calendar({ version: 'v3', auth: oAuth2Client });
            const eventResponse = await calendar.events.insert({
                calendarId: 'primary',
                resource: event,
            });
            console.log("Event created:", eventResponse.data);
            // Redirect to the completed notes page after successful event creation
            if (eventResponse.status === 200 || eventResponse.status === 201) {
                // Redirect to the completed notes page after successful event creation
                res.redirect("/note");
            } else {
                console.error("Failed to create event:", eventResponse);
                res.status(500).send("Error creating calendar event.");
            }
        } catch (error) {
            console.error("Error creating calendar event:", error);
            res.status(500).send("Error creating calendar event.");
        }
    } else {
        res.redirect("/completed_notes"); // Redirect if not publishing to calendar
    }
});

// Fetch completed notes route
app.get("/completed_notes", isAuthenticated, async (req, res) => {
    const identifier = "CreatedFromWebpage"; // The identifier to filter events
    try {
        const accessToken = req.session.tokenData.access_token;
        const oAuth2Client = new google.auth.OAuth2();
        oAuth2Client.setCredentials({ access_token: accessToken });

        const calendar = google.calendar({ version: 'v3', auth: oAuth2Client });
        const now = new Date().toISOString();
        const eventsResult = await calendar.events.list({
            calendarId: 'primary',
            timeMin: now,
            singleEvents: true,
            orderBy: 'startTime',
        });

        const events = eventsResult.data.items || []; // Retrieve events or default to an empty array

        // Filter events with the specific identifier
        const completedEvents = events.filter(event => event.description && event.description.includes(identifier));

        // Render the completed notes page with events
        res.render("completed_notes", { events: completedEvents,categoryColors: CATEGORY_COLORS  });
    } catch (error) {
        console.error("Error fetching events:", error);
        res.status(500).send("Error fetching events.");
    }
});
const CATEGORY_COLORS = {
    Work: '#007bff', // Blue
    Social: '#28a745', // Green
    Personal: '#dc3545', // Red
    // Add more categories and colors as needed
};

// Start server
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
