const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const nodemailer = require('nodemailer');
const supabase  = require("../utils/supabaseClient");
const { formatFullDate } = require("../utils/utils");

async function dailyEmailHandler(req, res) {
    try {
        const { R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_ENDPOINT, SMTP_USER, ELASTIC_KEY, EMAIL_TO, EMAIL_FROM, EMAIL_TEST } = process.env;
        if (!R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET || !R2_ENDPOINT || !SMTP_USER || !ELASTIC_KEY || !EMAIL_TO) {
            return res.status(500).json({ message: 'Server configuration error' });
        }

        const { type, date, listOfEmails } = req.body;

        // Initialize R2 client
        const r2 = new S3Client({
            region: "auto",
            endpoint: R2_ENDPOINT,
            credentials: {
                accessKeyId: R2_ACCESS_KEY_ID,
                secretAccessKey: R2_SECRET_ACCESS_KEY
            }
        });

        // Helper function to get image buffer from R2
        const getImageBuffer = async (imageName) => {
            try {
                const params = {
                    Bucket: R2_BUCKET,
                    Key: imageName
                };

                const response = await r2.send(new GetObjectCommand(params));
                const chunks = [];
                for await (const chunk of response.Body) {
                    chunks.push(chunk);
                }
                return Buffer.concat(chunks);
            } catch (error) {
                console.error(`Error getting image ${imageName}:`, error);
                return null;
            }
        };

        // Helper function to get image attachment
        const getImageAttachment = async (imageName, defaultName = '0.jpg') => {
            try {
                // First try the requested image
                let buffer = await getImageBuffer(imageName);
                if (!buffer) {
                    // Fallback to default image
                    buffer = await getImageBuffer(defaultName);
                    if (!buffer) return null;
                    return {
                        filename: defaultName,
                        content: buffer,
                        cid: 'default-image'
                    };
                }
                return {
                    filename: imageName,
                    content: buffer,
                    cid: `image-${imageName.split('.')[0]}`
                };
            } catch (error) {
                console.error(`Error in getImageAttachment for ${imageName}:`, error);
                return null;
            }
        };

        // Variables
        let email_date, email_subject, email_list;
        const nowIST = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));

        if (type === 'test') {
            email_date = `2000-${date.slice(5)}`;
            email_subject = `Birthday and Anniversary Notification ${formatFullDate(email_date)}`;
            email_list = listOfEmails || EMAIL_TEST.split(',').map(email => email.trim());
        }
        else if (type === 'realtime') {
            email_date = `2000-${String(nowIST.getMonth() + 1).padStart(2, '0')}-${String(nowIST.getDate()).padStart(2, '0')}`;
            email_subject = `Birthday and Anniversary Notification ${formatFullDate(email_date)}`;
            let allEmails = [];
            let pageSize = 1000;
            let from = 0;
            let to = pageSize - 1;
            let hasMore = true;

            while (hasMore) {
                const { data, error, count } = await supabase
                    .from('user')
                    .select('email', { count: 'exact' })
                    .eq('active', true).neq('email',null).neq('email','').range(from, to);

                if (error) throw error;

                allEmails = allEmails.concat(data.map(user => user.email));

                if (data.length < pageSize) {
                    hasMore = false;
                } else {
                    from += pageSize;
                    to += pageSize;
                }
            }

            email_list = [...new Set(allEmails)];
        }
        else if (type === 'advance') {
            nowIST.setDate(nowIST.getDate() + 1);
            email_date = `2000-${String(nowIST.getMonth() + 1).padStart(2, '0')}-${String(nowIST.getDate()).padStart(2, '0')}`;
            email_subject = `Advance Birthday and Anniversary Notification ${formatFullDate(email_date)}`;
            email_list = listOfEmails || EMAIL_TEST.split(',').map(email => email.trim());
        }

        console.log(`Email Date: ${email_date}`);
        console.log(`Email Subject: ${email_subject}`);
        console.log(`Email Count: ${email_list.length}`);

        const [birthdayData, spouseBirthdays, anniversaries] = await Promise.all([
            fetchByType(email_date, 'member'),
            fetchByType(email_date, 'spouse'),
            fetchByType(email_date, 'anniversary'),
        ]);

        const attachments = [];

        // Get congratulations gif
        const congratsAttachment = await getImageAttachment('try.gif');
        let congratsCid = '';
        if (congratsAttachment) {
            congratsCid = 'congratulations-gif';
            attachments.push({ ...congratsAttachment, cid: congratsCid });
        }

        const today = formatFullDate(email_date);

        let htmlTable = `
    <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
    <html xmlns="http://www.w3.org/1999/xhtml">
    <head>
      <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0" />
      <meta name="x-apple-disable-message-reformatting" />
      <title>Birthday and Anniversary Notifications</title>
    </head>
    <body style="margin:0; padding:0; font-family: Arial, sans-serif; color: #333; -webkit-text-size-adjust: 100%; text-size-adjust: 100%;">
      <!-- Main Container -->
      <table width="100%" border="0" cellspacing="0" cellpadding="0" bgcolor="#f7f7f7">
        <tr>
          <td align="center" valign="top">
            <!-- Email Container -->
            <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 900px;">
              ${congratsCid ? `
              <tr>
                <td align="center" style="padding: 20px 0;">
                  <img src="cid:${congratsCid}" alt="Celebration Image" style="max-width: 100%; height: auto;" />
                </td>
              </tr>
              ` : ''}
              <tr>
                <td style="padding: 20px;">
                  <p style="margin: 0 0 15px 0; font-size: 16px; -webkit-text-size-adjust: 100%; text-size-adjust: 100%;">Dear Esteemed Rotary Leaders,</p>
                  <p style="margin: 0 0 15px 0; font-size: 16px; -webkit-text-size-adjust: 100%; text-size-adjust: 100%;">Warm greetings from the Rotary family of District 3012!</p>
                  <p style="margin: 0 0 15px 0; font-size: 16px; -webkit-text-size-adjust: 100%; text-size-adadjust: 100%;">On behalf of District Governor <strong>Rtn. Dr. Amita Mohindru</strong> and the distinguished <strong>Rtn. Dr. Capt. Anil Mohindru</strong>, we take great pleasure in extending our heartfelt wishes to all those celebrating their birthdays and wedding anniversaries today.</p>
                  <p style="margin: 0 0 15px 0; font-size: 16px; -webkit-text-size-adjust: 100%; text-size-adjust: 100%;">May your day be filled with joy, good health, and cherished moments of togetherness. This simple gesture is a celebration of the spirit of fellowship that binds us all.</p>
                  <p style="margin: 0 0 30px 0; font-size: 16px; -webkit-text-size-adjust: 100%; text-size-adjust: 100%;">Stay blessed, stay healthy, and keep inspiring!</p>
    `;

        async function generateCardsSection(title, records, getDetailsFn, isAnniversary = false) {
            if (!records || records.length === 0) return '';

            let html = `
              <tr>
                <td style="padding: 10px 0;">
                  <h2 style="font-family: Arial, sans-serif; color: #333; margin: 0 0 15px 0; font-size: 20px; -webkit-text-size-adjust: 100%; text-size-adjust: 100%;">${title} on ${today}</h2>
                  <table width="100%" border="0" cellspacing="0" cellpadding="0">
                    <tr>
                      <td>
                        <table width="100%" border="0" cellspacing="15" cellpadding="0">
                          <tr>
      `;

            let column1 = [];
            let column2 = [];
            records.forEach((record, index) => {
                if (index % 2 === 0) {
                    column1.push(record);
                } else {
                    column2.push(record);
                }
            });

            html += `<td width="50%" valign="top" style="padding: 0;">`;

            for (const record of column1) {
                html += await generateCard(record, getDetailsFn, isAnniversary);
            }

            html += `</td>`;
            html += `<td width="50%" valign="top" style="padding: 0;">`;

            for (const record of column2) {
                html += await generateCard(record, getDetailsFn, isAnniversary);
            }

            html += `</td>`;
            html += `</tr>`;

            html += `
                        </table>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
      `;

            return html;
        }

        async function generateCard(record, getDetailsFn, isAnniversary = false) {
            const imageName = `${record.id}.jpg`;
            const partnerImageName = record?.partner?.id ? `${record.partner.id}.jpg` : null;
            
            const mainAttachment = await getImageAttachment(imageName);
            const partnerAttachment = partnerImageName ? await getImageAttachment(partnerImageName) : null;

            let mainCid = '';
            let partnerCid = '';

            if (mainAttachment) {
                mainCid = mainAttachment.filename === '0.jpg' ? 'default-image' : `image-${record.id}`;
                attachments.push({ ...mainAttachment, cid: mainCid });
            }

            if (partnerAttachment) {
                partnerCid = partnerAttachment.filename === '0.jpg' ? 'default-image' : `image-${record.partner.id}`;
                attachments.push({ ...partnerAttachment, cid: partnerCid });
            }

            const details = getDetailsFn(record);

            const formatNameForDisplay = (name) => {
                if (!name) return '&nbsp;';

                if (isAnniversary && name.includes(' & ')) {
                    const [name1, name2] = name.split(' & ');
                    return `
        <span style="display: inline-block; width: 100%;">${toTitleCase(name1)} &</span>
        <span style="display: inline-block; width: 100%;">${toTitleCase(name2)}</span>
      `;
                }
                return toTitleCase(name);
            };

            const renderFields = (fields) => {
                const availableFields = fields.filter(f => f.value && f.value !== 'NULL');
                const rowsToShow = 5;

                let html = '';
                for (let i = 0; i < rowsToShow; i++) {
                    const field = availableFields[i] || { label: '', value: '' };
                    let displayValue = field.value;

                    if (field.label === 'Email:' && field.value) {
                        displayValue = `<a href="mailto:${field.value}" style="color:inherit;text-decoration:underline;">${field.value}</a>`;
                    } else {
                        displayValue = toTitleCase(field.value);
                    }

                    html += `
        <tr>
          <td style="padding: 0; font-size: 14px; -webkit-text-size-adjust: 100%; text-size-adjust: 100%; height: 18px; line-height: 1;">
            <strong>${field.label || '&nbsp;'}</strong>${displayValue || '&nbsp;'}
          </td>
        </tr>
      `;
                }
                return html;
            };

            let cardHtml = `
    <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin-bottom: 15px; background-color: #c4e6f8; border: 1px solid #a1cbe2; border-radius: 8px; overflow: hidden; height: 160px;">
      <tr>
        <td style="padding: 10px;">
          <table width="100%" border="0" cellspacing="0" cellpadding="0" style="height: 100%;">
            <tr>
              <td width="140" valign="top" style="padding-right: 10px; text-align: center;">
                <table border="0" cellspacing="0" cellpadding="0" style="display: inline-block; margin-top: 16px;">
                  <tr>
                    ${mainCid ? `<td style="padding-right: ${partnerCid ? '5px' : '0'};"><img src="cid:${mainCid}" width="60" height="84" style="border-radius: 12px; object-fit: cover; display: block;" /></td>` : ''}
                    ${partnerCid ? `<td><img src="cid:${partnerCid}" width="60" height="84" style="border-radius: 12px; object-fit: cover; display: block;" /></td>` : ''}
                  </tr>
                </table>
              </td>
              
              <td valign="top">
                <table border="0" cellspacing="0" cellpadding="0" width="100%" style="height: 100%;">
                  <tr>
                    <td style="padding: 8px 0 4px 0; height: 36px; vertical-align: top;">
                      <h3 style="font-family: Arial, sans-serif; font-size: 16px; margin: 0; color: #333; -webkit-text-size-adjust: 100%; text-size-adjust: 100%; line-height: 1.3;">
                        ${formatNameForDisplay(details.name)}
                      </h3>
                    </td>
                  </tr>
                  
                  <tr>
                    <td style="vertical-align: top; padding: 0;">
                      <table border="0" cellspacing="0" cellpadding="0" width="100%" style="line-height: 1;">
                        ${renderFields(details.extraFields)}
                      </table>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `;

            return cardHtml;
        }

        htmlTable += await generateCardsSection("Member's Birthday", birthdayData, (record) => ({
            name: record.name || '',
            extraFields: [
                { label: 'Post:', value: record.role },
                { label: 'Club:', value: record.club },
                { label: 'Phone:', value: record.phone },
                { label: 'Email:', value: record.email },
            ],
        }));

        htmlTable += await generateCardsSection("Partner's Birthday", spouseBirthdays, (record) => ({
            name: record.name || '',
            extraFields: [
                { label: "Partner:", value: record?.partner?.name },
                { label: 'Club:', value: record?.club },
                { label: 'Phone:', value: record.phone },
                { label: 'Email:', value: record.email },
            ],
        }));

        htmlTable += await generateCardsSection('Wedding Anniversary', anniversaries, (record) => ({
            name: `${record.name} & ${record?.partner?.name}` || '',
            extraFields: [
                { label: 'Post:', value: record.role },
                { label: 'Club:', value: record.club },
                { label: 'Phone:', value: record.phone },
                { label: 'Email:', value: record.email },
            ],
        }), true);

        // Get footer logos from R2
        const logoAttachments = await Promise.all([
            getImageAttachment('006.jpg'),
            getImageAttachment('007.jpg'),
            getImageAttachment('008.jpg'),
            getImageAttachment('009.jpg')
        ]);

        const [logo006, logo007, logo008, logo009] = logoAttachments;
        let logo006Cid = '', logo007Cid = '', logo008Cid = '', logo009Cid = '';

        if (logo006) {
            logo006Cid = 'logo-006';
            attachments.push({ ...logo006, cid: logo006Cid });
        }
        if (logo007) {
            logo007Cid = 'logo-007';
            attachments.push({ ...logo007, cid: logo007Cid });
        }
        if (logo008) {
            logo008Cid = 'logo-008';
            attachments.push({ ...logo008, cid: logo008Cid });
        }
        if (logo009) {
            logo009Cid = 'logo-009';
            attachments.push({ ...logo009, cid: logo009Cid });
        }

        htmlTable += `
              <tr>
                <td style="padding: 20px 0;">
                  <table width="100%" border="0" cellspacing="0" cellpadding="0">
                    <tr>
                      <td style="border-top: 1px solid #ddd; padding: 20px 0;">
                        <p style="margin: 0 0 15px 0; font-size: 16px; -webkit-text-size-adjust: 100%; text-size-adjust: 100%;">
                          With best wishes and regards,<br />
                          <strong>Team Influencer 2025-26</strong>
                        </p>
                        
                        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin: 10px 0;">
                          <tr>
                            <td align="left">
                              <table border="0" cellspacing="0" cellpadding="0">
                                <tr>
                                  ${logo009Cid ? `
                                  <td style="padding-right: 10px; vertical-align: middle;">
                                    <img src="cid:${logo009Cid}" style="max-height: 60px; display: block;" alt="Team Logo" />
                                  </td>` : ''}
                                  ${logo006Cid ? `
                                  <td style="padding-right: 10px; vertical-align: middle;">
                                    <img src="cid:${logo006Cid}" style="max-height: 60px; display: block;" alt="Team Logo" />
                                  </td>` : ''}
                                  ${logo008Cid ? `
                                  <td style="vertical-align: middle;">
                                    <img src="cid:${logo008Cid}" style="max-height: 60px; display: block;" alt="Team Logo" />
                                  </td>` : ''}
                                </tr>
                              </table>
                            </td>
                          </tr>
                        </table>

                        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin-top: 20px;">
                          <tr>
                            <td align="center">
                              <table border="0" cellspacing="0" cellpadding="0" style="display: inline-block;">
                                <tr>
                                  <td style="padding: 10px 10px 10px 0; border: none;">
                                    ${logo007Cid ? `<img src="cid:${logo007Cid}" style="max-height: 60px;" alt="TBAM Logo" />` : ''}
                                  </td>
                                  <td style="border-left: 1px solid #000; padding: 10px; vertical-align: middle; border-top: none; border-bottom: none; border-right: none;">
                                    <p style="margin: 0; font-size: 12px; -webkit-text-size-adjust: 100%; text-size-adjust: 100%; color: #555; text-align: left;">
                                      <em>Designed and Maintained by</em><br />
                                      <strong>Tirupati Balaji Advertising & Marketing</strong><br />
                                      (Director of TBAM Group Rtn Dr Dheeraj Kumar Bhargava Ph:+919810522380)<br />
                                      Founder and Charter President of RC Indirapuram Galore<br />
                                      District Club Co-coordinator 2025-26
                                    </p>
                                  </td>
                                </tr>
                              </table>
                            </td>
                          </tr>
                        </table>
                        
                        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin: 40px 0 0 0;">
                          <tr>
                            <td align="left" style="font-family: Arial, sans-serif; font-size: 12px; -webkit-text-size-adjust: 100%; text-size-adjust: 100%; color: #777;">
                              If you would prefer not to receive these emails, please
                              <strong>click the unsubscribe link at the bottom of this email</strong>.
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
    `;

        const transporter = nodemailer.createTransport({
            host: 'smtp.elasticemail.com',
            port: 587,
            secure: false,
            auth: { user: SMTP_USER, pass: ELASTIC_KEY }
        });

        const { successCount, failureCount, failedRecipients } = await sendInBatches(email_list, 50, {
            transporter,
            html: htmlTable,
            attachments,
            EMAIL_FROM,
            today,
            email_subject
        });

        return res.json({
            message: 'Emails processed',
            successCount,
            failureCount,
            failedRecipients
        });

    } catch (error) {
        console.error('Send email error:', error);
        return res.status(500).json(
            { message: error.message || 'Failed to send email' }
        );
    }
}

async function sendInBatches(recipients, batchSize, { transporter, html, attachments, EMAIL_FROM, today, email_subject }) {
    let successCount = 0;
    let failureCount = 0;
    const failedRecipients = [];

    for (let i = 0; i < recipients.length; i += batchSize) {
        const batch = recipients.slice(i, i + batchSize);

        const promises = batch.map(recipient =>
            transporter.sendMail({
                from: `"DG Dr. Amita Mohindru" <${EMAIL_FROM}>`,
                to: recipient,
                replyTo: 'amitadg2526rid3012@gmail.com, anilkmohindru@gmail.com',
                subject: email_subject,
                html,
                attachments,
                headers: {
                    'X-ElasticEmail-Settings': JSON.stringify({
                        UnsubscribeLinkText: '',
                        UnsubscribeLinkType: 'None',
                        Channels: 'birthday-email',
                        IsTransactional: true,
                        TrackOpens: true,
                        TrackClicks: true
                    })
                }
            }).then(() => {
                console.log("✅ Sent to", recipient);
                successCount++;
            }).catch(err => {
                console.error("❌ Failed to send to", recipient, err.message);
                failureCount++;
                failedRecipients.push({ email: recipient, error: err.message });
            })
        );

        await Promise.all(promises);
        await new Promise(r => setTimeout(r, 1000));
    }

    return { successCount, failureCount, failedRecipients };
}

async function fetchByType(date, type) {
    console.log(`Fetching data for type: ${type} on date: ${date}`);
    try {
        let query = supabase.from('user');
        let processedData = [];

        if (type === 'member') {
            query = query
                .select('id, name, club, phone, email, role')
                .eq('type', 'member')
                .eq('dob', date)
                .eq('active', true);
        } else if (type === 'spouse') {
            query = query
                .select('id, name, club, phone, email, partner:partner_id (id, name)')
                .eq('type', 'spouse')
                .eq('dob', date)
                .eq('active', true);
        } else if (type === 'anniversary') {
            query = query
                .select('id, name, club, email, phone, role, partner:partner_id (id, name, club, email, phone, active)')
                .eq('type', 'member')
                .eq('anniversary', date)
                .eq('active', true);
        } else {
            throw new Error("Invalid type provided");
        }
        const { data, error } = await query;
        if (error) throw error;

        if (!data || data.length === 0) return [];
        processedData = data;

        if (type === "anniversary") {
            const uniquePairs = new Set();
            processedData = data.filter((item) => {
                if (!item.partner || item.partner.active !== true) return false;

                const pairKey1 = `${item.id}-${item.partner.id}`;
                const pairKey2 = `${item.partner.id}-${item.id}`;
                if (uniquePairs.has(pairKey2)) return false;

                uniquePairs.add(pairKey1);
                return true;
            });
        }
        return processedData;
    } catch (err) {
        console.error("fetchByType error:", err);
        return [];
    }
}

function toTitleCase(str) {
    if (!str || typeof str !== 'string') return '';
    return str
        .split(' ')
        .map(word => {
            const lower = word.toLowerCase();
            if (lower === 'pdg') return 'PDG';
            if (lower === 'ca') return 'CA';
            return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
        })
        .join(' ');
}

module.exports = { dailyEmailHandler };