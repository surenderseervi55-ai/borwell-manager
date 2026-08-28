const { google } = require('googleapis');
require('dotenv').config();

let driveClient = null;

function getDrive() {
  if (driveClient) return driveClient;

  try {
    const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
    if (!keyFile) {
      console.log('Google Drive: No service account key configured');
      return null;
    }

    const auth = new google.auth.GoogleAuth({
      keyFile: keyFile,
      scopes: ['https://www.googleapis.com/auth/drive.file'],
    });

    driveClient = google.drive({ version: 'v3', auth });
    return driveClient;
  } catch (err) {
    console.error('Google Drive init error:', err.message);
    return null;
  }
}

async function uploadBackup(data, filename) {
  const drive = getDrive();
  if (!drive) throw new Error('Google Drive not configured');

  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  const fileMetadata = { name: filename };
  if (folderId && folderId !== 'your_folder_id_here') {
    fileMetadata.parents = [folderId];
  }

  const media = {
    mimeType: 'application/json',
    body: Buffer.from(JSON.stringify(data, null, 2)),
  };

  const file = await drive.files.create({
    resource: fileMetadata,
    media: media,
    fields: 'id, webViewLink',
  });

  return file.data;
}

module.exports = { getDrive, uploadBackup };
