const sharp = require("sharp");
const nodemailer = require("nodemailer");
const { GetObjectCommand } = require("@aws-sdk/client-s3");
const s3 = require("../utils/s3Client");
const supabase = require("../utils/supabaseClient");


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

async function fetchUserByIdAndType(userId, eventType) {
  try {
    let query = supabase.from("user").select(`
      id, name,email,dob, anniversary, poster, annposter,
      partner:partner_id (id, name, club, email, phone, active, annposter, poster)
    `).eq("id", userId).eq("active", true);

    const { data, error } = await query;
    if (error) throw error;

    if (!data || data.length === 0) {
      return null;
    }

    const user = data[0];

    // Validate if user can receive email for the specified event type
    if (eventType === "birthday") {
      if (user.type !== "member" && user.type !== "spouse") {
        throw new Error("User is not a member or spouse for birthday event");
      }
      if (!user.poster) {
        throw new Error("User does not have poster enabled for birthday");
      }
    } else if (eventType === "anniversary") {
      if (!user.partner?.active) {
        throw new Error("Partner is not active or does not exist");
      }
      if (!user.annposter && !user.partner.annposter) {
        throw new Error("Neither user nor partner has annposter enabled");
      }
    } else {
      throw new Error("Invalid event type. Use 'birthday' or 'anniversary'");
    }

    return user;
  } catch (err) {
    console.error("fetchUserByIdAndType error:", err);
    throw err;
  }
}

async function sendSingleEmail(user, eventType) {
  const { SMTP_USER, ELASTIC_KEY, EMAIL_FROM } = process.env;

  if (!SMTP_USER || !ELASTIC_KEY || !EMAIL_FROM) {
    throw new Error("Server configuration error");
  }

  const transporter = nodemailer.createTransport({
    host: "smtp.elasticemail.com",
    port: 587,
    secure: false,
    auth: { user: SMTP_USER, pass: ELASTIC_KEY },
  });

  const userEmail = user.email;
  if (!userEmail) {
    throw new Error("User does not have an email address");
  }

  // Determine image name based on event type
  let imageName;
  if (eventType === "birthday") {
    imageName = `${user.id}_poster.jpg`;
  } else if (eventType === "anniversary") {
    imageName = user.annposter ? `${user.id}_anniv.jpg` : `${user.partner.id}_anniv.jpg`;
  }

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
  const isAnniv = eventType === "anniversary";

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
    to: userEmail,
    bcc: "prateekbhargava1002@yahoo.com",
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

  return userEmail;
}

async function singleEmailHandler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const { id, eventType } = req.body;

    if (!id || !eventType) {
      return res.status(400).json({ 
        message: "Missing required parameters",
        required: ["id", "eventType"],
        example: { "id": 123, "eventType": "birthday" }
      });
    }

    if (!["birthday", "anniversary"].includes(eventType)) {
      return res.status(400).json({ 
        message: "Invalid event type",
        validTypes: ["birthday", "anniversary"]
      });
    }

    console.log(`Processing single email for ID: ${id}, Event: ${eventType}`);

    // Fetch user data
    const user = await fetchUserByIdAndType(id, eventType);
    if (!user) {
      return res.status(404).json({ 
        message: "User not found or not active",
        id,
        eventType
      });
    }

    // Send email
    const sentTo = await sendSingleEmail(user, eventType);

    return res.status(200).json({
      message: "Email sent successfully",
      sentTo,
      userId: id,
      eventType,
      userName: user.name,
      partnerName: user.partner?.name || null
    });

  } catch (error) {
    console.error("Single email error:", error);
    
    if (error.message.includes("does not have") || 
        error.message.includes("not active") ||
        error.message.includes("Invalid event type")) {
      return res.status(400).json({ 
        message: error.message,
        id: req.body.id,
        eventType: req.body.eventType
      });
    }

    return res.status(500).json({ 
      message: error.message || "Failed to send email",
      id: req.body.id,
      eventType: req.body.eventType
    });
  }
}

module.exports = { singleEmailHandler };