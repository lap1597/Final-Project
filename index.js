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


app.get("/", (req, res) => {
    res.render("index.ejs", { isAuthenticated: !!req.session.user });
});

app.get("/about", (req, res) => {
    res.render("about.ejs", { isAuthenticated: !!req.session.user });
});

app.get("/contact", (req, res) => {
    res.render("contact.ejs", { isAuthenticated: !!req.session.user });
});
app.get("/note", isAuthenticated, (req, res) => {
    res.render("note.ejs", { isAuthenticated: !!req.session.user });
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
              //  dateTime: new Date(`${start}T${startTime}`).toISOString(),
              dateTime: formatDateTime(start, startTime),
                timeZone: 'America/Los_Angeles', // Adjust time zone as needed
            },
            end: {
               // dateTime: new Date(`${end}T${endTime}`).toISOString(),
               dateTime: formatDateTime(end, endTime), // Use formatted end time
                timeZone: 'America/Los_Angeles',
            },
            // colorId: CATEGORY_COLORS[category]
           // colorId: CATEGORY_COLORS[category]
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
 //   const identifier = "CreatedFromWebpage"; // The identifier to filter events
    try {
        const accessToken = req.session.tokenData.access_token;
        const oAuth2Client = new google.auth.OAuth2();
        oAuth2Client.setCredentials({ access_token: accessToken });

        const calendar = google.calendar({ version: 'v3', auth: oAuth2Client });
        const now = new Date().toISOString();
        const oneWeekFromNow = new Date(); // Create a new date object
        oneWeekFromNow.setDate(oneWeekFromNow.getDate() + 2); // Add 7 days
        const timeMax =  oneWeekFromNow.toISOString();
        const eventsResult = await calendar.events.list({
            calendarId: 'primary',
            timeMin: now,
            timeMax: timeMax,
            singleEvents: true,
            orderBy: 'startTime',
        });
        //console.log(eventsResult.data.items);
        
        if (eventsResult.data && eventsResult.data.items) {
            const events = eventsResult.data.items; // Extract events from the response

            // Render the completed notes page with events
            res.render("complete_note.ejs", {
                isAuthenticated: !!req.session.user,
                events: events,
                CATEGORY_COLORS: CATEGORY_COLORS,
            });

        } else {
            console.error("No items found in eventsResult:", eventsResult);
            res.status(404).send("No events found.");
        }
    } catch (error) {
        console.error("Error fetching events:", error);
        res.status(500).send("Error fetching events.");
    }
});
const formatDateTime = (date, time) => {
    const dt = new Date(`${date}T${time}`);
    return dt.toISOString().slice(0, 19); // Format as YYYY-MM-DDTHH:mm:ss
};

const CATEGORY_COLORS = {
    '1': '#D9EAD3', // Light green
    '2': '#CFE2F3', // Light blue
    '3': '#EAD1DC', // Pink
    '4': '#F4CCCC', // Red
    '5': '#FCE6B1', // Yellow
    '6': '#EAD1DC', // Purple
    '7': '#D9D9D9', // Gray
    '8': '#E4B5C2', // Rose
    '9': '#B6D7A8', // Soft green
    '10': '#C9DAF8', // Light blue
    '11': '#F6BCF2', // Lavender
    '12': '#EAD1DC', // Coral
    '13': '#D1C4E9', // Lilac
    '14': '#D9EAD3', // Mint
    '15': '#F1C6F7', // Purple
    '16': '#FFBC91', // Salmon
    '17': '#B6D7A8', // Green
    '18': '#FFD8B3', // Peach
    '19': '#FFF2A6', // Soft yellow
    '20': '#FFABAB', // Light red
    '21': '#FF5733', // Bright red
    '22': '#35C29A'  // Teal
};


// Start server
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
