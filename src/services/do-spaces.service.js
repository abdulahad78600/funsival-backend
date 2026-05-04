const AWS = require('aws-sdk');

const {
  DO_SPACES_KEY,
  DO_SPACES_SECRET,
  DO_SPACES_ENDPOINT,
  DO_SPACES_BUCKET,
  DO_SPACES_REGION,
} = process.env;

const spacesEndpoint = new AWS.Endpoint(DO_SPACES_ENDPOINT);

const s3 = new AWS.S3({
  endpoint: spacesEndpoint,
  accessKeyId: DO_SPACES_KEY,
  secretAccessKey: DO_SPACES_SECRET,
  region: DO_SPACES_REGION,
});

async function uploadImageToSpaces(fileBuffer, fileName, mimeType) {
  const params = {
    Bucket: DO_SPACES_BUCKET,
    Key: fileName,
    Body: fileBuffer,
    ACL: 'public-read',
    ContentType: mimeType,
  };
  return s3.upload(params).promise();
}

module.exports = {
  uploadImageToSpaces,
};
