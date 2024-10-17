import express from "express";
import nodemailer from "nodemailer";
import bodyParser from "body-parser";
import dotenv from "dotenv";
dotenv.config();
const app=express();
const port = 3000;
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json()); 

app.set('view engine', 'ejs');
app.use(express.static("public"));

app.get("/",(req,res)=>{
    res.render("index.ejs");
});

app.get("/about", (req, res) => {
    res.render("about.ejs");
});
  
app.get("/contact", (req, res) => {
    res.render("contact.ejs");
});
  app.post("/send-email", (req, res) => {
    const { name, email, message } = req.body;

    // Use environment variables for email credentials
    let transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.EMAIL_USER,  // Email from .env file
            pass: process.env.EMAIL_PASS   // Password or app password from .env file
        }
    });

    let mailOptions = {
        from: process.env.EMAIL_USER,
        to: "lapphamsf@gmail.com",
        subject: `New message from ${name}`,
        text: message
    };

    transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
            return console.log(error);
        }
        console.log("Email sent: " + info.response);
        res.send("Email has been sent successfully!");
    });
});


app.listen(port,()=>{
    console.log(`Server running in ${port}`);
});
