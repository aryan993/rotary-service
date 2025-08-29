const sharp = require("sharp");
const nodemailer = require("nodemailer");
const { GetObjectCommand } = require("@aws-sdk/client-s3");
const s3 = require("../utils/s3Client");
const supabase = require("../utils/supabaseClient");

// Helper function to format date
function formatFullDate(dateString) {
  const date = new Date(dateString);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

async function getCompressedImageBuffer(fileName) {
  try {
    const command = new GetObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: fileName,
    });

    const response = await s3.send(command);
    const stream = response.Body;

    const chunks = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    const buffer = Buffer.concat(chunks);

    // Compress using sharp
    return await sharp(buffer)
      .resize({ width: 1000 })
      .jpeg({ quality: 75 })
      .toBuffer();
  } catch (err) {
    console.error("R2 image fetch/compression error:", err);
    return null;
  }
}

async function fetchByType(date, type) {
  try {
    let query = supabase.from("user");
    let processedData = [];

    if (type === "member") {
      query = query
        .select("id, name, email")
        .eq("type", "member")
        .eq("dob", date)
        .eq("poster", true)
        .eq("active", true);
    } else if (type === "spouse") {
      query = query
        .select("id, name, email, partner:partner_id (id, name)")
        .eq("type", "spouse")
        .eq("dob", date)
        .eq("poster", true)
        .eq("active", true);
    } else if (type === "anniversary") {
      query = query
        .select(
          "id, name,email,active,annposter, partner:partner_id (id, name,email,annposter,active)"
        )
        .eq("anniversary", date)
        .eq("active", true);
    } else {
      throw new Error("Invalid type provided");
    }

    const { data, error } = await query;
    if (error) throw error;

    if (!data || data.length === 0) return [];
    processedData = data;

    if (type === "anniversary") {
      processedData = data.filter((item) => item.active===true && item.partner.active === true).filter((item)=> item.annposter===true || item.partner.annposter===true)
    }
    return processedData;
  } catch (err) {
    console.error("fetchByType error:", err);
    return [];
  }
}

// New function to fetch individual user data
async function fetchIndividualUser(id, event) {
  try {
    let query = supabase.from("user").select("*");

    if (event === "birthday") {
      query = query
        .select("id, name, email, poster, type")
        .eq("id", id)
        .eq("active", true);
    } else if (event === "anniversary") {
      query = query
        .select("id, name, email,annposter,active, partner:partner_id (id, name, annposter, active)")
        .eq("id", id)
        .eq("active", true);
    } else {
      throw new Error("Invalid event type");
    }

    const { data, error } = await query;
    if (error) throw error;

    if (!data || data.length === 0) return null;

    const user = data[0];
    // For anniversary, check if partner is active
    if (event === "anniversary") {
      if(user.active===true && user.partner.active==true && (user.annposter===true||user.partner.annposter===true)){
        return user;
      }else{return null;}
    }

    return user;
  } catch (err) {
    console.error("fetchIndividualUser error:", err);
    return null;
  }
}

function toTitleCase(str) {
  if (!str || typeof str !== "string") return "";
  return str
    .split(" ")
    .map((word) => {
      const lower = word.toLowerCase();
      if (lower === "pdg") return "PDG";
      if (lower === "ca") return "CA";
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

async function personalEmailHandler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const { SMTP_USER, ELASTIC_KEY, EMAIL_FROM } = process.env;

    if (!SMTP_USER || !ELASTIC_KEY || !EMAIL_FROM) {
      return res.status(500).json({ message: "Server configuration error" });
    }

    const { type, id, event } = req.body;

    // Validate individual mode parameters
    if (type === "individual") {
      if (!id || !event) {
        return res.status(400).json({ 
          message: "For individual type, both id and event are required" 
        });
      }
      if (!["birthday", "anniversary"].includes(event)) {
        return res.status(400).json({ 
          message: "Event must be either 'birthday' or 'anniversary'" 
        });
      }
    }

    const transporter = nodemailer.createTransport({
      host: "smtp.elasticemail.com",
      port: 587,
      secure: false,
      auth: { user: SMTP_USER, pass: ELASTIC_KEY },
    });

    let allRecipients = [];

    if (type === "realtime") {
      const istNow = new Date(
        new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" })
      );
      const year = istNow.getFullYear();
      const month = String(istNow.getMonth() + 1).padStart(2, "0");
      const day = String(istNow.getDate()).padStart(2, "0");
      const normalizedDate = `2000-${month}-${day}`;
      const today = formatFullDate(`${year}-${month}-${day}`);
      console.log(today);

      const [birthdayData, spouseBirthdays, anniversaries] = await Promise.all([
        fetchByType(normalizedDate, "member"),
        fetchByType(normalizedDate, "spouse"),
        fetchByType(normalizedDate, "anniversary"),
      ]);

      allRecipients = [
        ...birthdayData.map((r) => ({ ...r, type: "member" })),
        ...spouseBirthdays.map((r) => ({ ...r, type: "spouse" })),
        ...anniversaries.map((r) => ({ ...r, type: "anniversary" })),
      ];
    } else if (type === "individual") {
      const user = await fetchIndividualUser(id, event);
      if (!user) {
        return res.status(404).json({ 
          message: "User not found or not eligible for email" 
        });
      }

      // Transform user data to match the expected format
      const recipient = {
        ...user,
        type: event === "birthday" ? "member" : "anniversary"
      };

      allRecipients = [recipient];
    } else {
      return res.status(400).json({ 
        message: "Type must be either 'realtime' or 'individual'" 
      });
    }

    let sentCount = 0;

    for (const user of allRecipients) {
      const userEmail = user.email;
      if (!userEmail) continue;

      const imageName =
        user.type === "anniversary"
          ? user.annposter
            ? `${user.id}_anniv.jpg`
            : `${user.partner.id}_anniv.jpg`
          : `${user.id}_poster.jpg`;

      const buffer = await getCompressedImageBuffer(imageName);

      const attachments = [];
      let cid = "";
      if (buffer) {
        cid = `poster-${user.id}`;
        attachments.push({
          filename: imageName,
          content: buffer,
          cid,
        });
      }

      const name = toTitleCase(user.name);
      const partnerName = toTitleCase(user?.partner?.name || "");
      const isAnniv = user.type === "anniversary";

      const posterImg = cid
        ? `<img src="cid:${cid}" style="width: 300px; max-width: 100%; border-radius: 12px; margin: 20px 0;" alt="Poster" />`
        : "";

      const message = isAnniv
        ? `
        <p>Dear ${name} & ${partnerName},</p>
        <p>Greetings !!!</p>
        <p>On behalf of the entire Rotary family of District 3012, We extend our warmest wishes and heartfelt blessings while you celebrate the beautiful milestone of your Wedding Anniversary today.</p>
        <p>May this special day remind you of the sacred vows you once made — promises of love, loyalty, and unwavering support. Through every season, We pray that your journey together continues to inspire all who witness the grace, strength, and joy you share in blissful togetherness.</p>
        <p>May your bond grow deeper with time, and may every anniversary bring you closer in heart and soul.</p>
        ${posterImg}
        <p>With affection and admiration,<br/>
        Your Rotary Family – District 3012<br/>
        <strong>Dr.Amita  Mohindru AKS- Chair Circle</strong><br/>
        <strong>Capt.Dr.Anil K.Mohindru AKS- Chair Circle</strong></p>
      `
        : `
        <p>Dear ${name},</p>
        <p>Greetings ! Happy Birthday</p>
        <p>On behalf of Rotary District 3012, we extend our warmest greetings and heartfelt blessings to you on your special day.</p>
        <p>Your unwavering commitment to Service Above Self has touched countless lives and brought hope and happiness to many people around you in your communities. Today, we celebrate your spirit, your service, and the radiant light you bring to the Rotary family and the world around you.</p>
        <p>May your life be filled with robust health, bounded joy, and an inspiring journey ahead. We pray for your long life, enduring happiness, and continued strength to serve with the same passion, purpose, and pride that truly define a Rotarian.</p>
        ${posterImg}
        <p>Happy Birthday! May this year be your most impactful and fulfilling yet.</p>
        <p>With deep respect and warm regards,<br/>
        Rotary District 3012<br/>
        <strong>Dr.Amita Mohindru AKS - Chair Circle</strong><br/>
        <strong>Capt.Dr.Anil K.Mohindru AKS- Chair Circle</strong></p>
      `;

      const html = `
        <div style="font-family: Arial, sans-serif; padding: 20px; text-align: left;">
          ${message}
        </div>
      `;

      const subject = isAnniv
        ? `Happy Anniversary, ${name} & ${partnerName}!`
        : `Happy Birthday, ${name}!`;

      await transporter.sendMail({
        from: `"DG Dr. Amita Mohindru" <${EMAIL_FROM}>`,
        to: "bansalaryan2000@gmail.com",
        //bcc: "prateekbhargava1002@yahoo.com",
        replyTo: "amitadg2526rid3012@gmail.com",
        subject,
        html,
        attachments,
        headers: {
          "X-ElasticEmail-Settings": JSON.stringify({
            UnsubscribeLinkText: "",
            UnsubscribeLinkType: "None",
          }),
        },
      });
      sentCount++;
    }

    return res.status(200).json({
      message: "Emails sent successfully",
      count: sentCount,
      type: type,
      ...(type === "individual" && { id, event })
    });
  } catch (error) {
    console.error("Send email error:", error);
    return res
      .status(500)
      .json({ message: error.message || "Failed to send email" });
  }
}

module.exports = { personalEmailHandler };