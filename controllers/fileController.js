const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const upload = require("../middlewares/multer");
const path = require("path");
const fs = require("fs");
const axios = require('axios');  // Import axios to download the file as a stream

exports.getAllFiles = async (req, res) => {
  try {
    const files = await prisma.file.findMany();
    res.render("files", { files, user: req.user });
  } catch (error) {
    console.error("Error fetching files:", error);
    res.status(500).send("Error fetching files");
  }
};

exports.viewFile = async (req, res) => {
  try {
    console.log("Request received for file:", req.params.fileId);

    const file = await prisma.file.findUnique({
      where: { id: parseInt(req.params.fileId) },
    });

    if (!file) {
      console.log("File not found in database");
      return res.status(404).send("File not found");
    }

    console.log("File found:", file);

    res.render("file-details", {
      file,
      user: req.user,
      folderId: file.folderId || null,
    });
  } catch (error) {
    console.error("Error fetching file:", error);
    res.status(500).send("Error fetching file details");
  }
};


exports.downloadFile = async (req, res, next) => {
  try {
    const { fileId, folderId } = req.params;
    const file = await prisma.file.findUnique({
      where: { id: parseInt(fileId) },
    });

    if (!file) {
      return res.status(404).send("File not found");
    }

    if (folderId && file.folderId !== parseInt(folderId)) {
      return res.status(400).send("File is not in the specified folder");
    }

    // If the file is hosted on Cloudinary (check if URL starts with Cloudinary base URL)
    if (file.filepath.startsWith("https://res.cloudinary.com")) {
      const fileUrl = file.filepath;

      // Set headers to force download
      res.attachment(file.filename); // This forces the download
      axios({
        url: fileUrl,
        method: 'GET',
        responseType: 'stream',
      })
        .then(response => {
          response.data.pipe(res); // Pipe the file stream to the response
        })
        .catch(err => {
          console.error("Error downloading file from Cloudinary:", err);
          return res.status(500).send("Error downloading file");
        });
    } else {
      // For local files (not hosted on Cloudinary)
      const filePath = path.join(__dirname, "../", file.filepath.replace(/\\/g, "/"));
      res.download(filePath, file.filename, (err) => {
        if (err) {
          console.error("Error downloading file:", err);
          return res.status(500).send("Error downloading file");
        }
      });
    }
  } catch (error) {
    console.error("Error in file download controller:", error);
    return res.status(500).send("Internal server error");
  }
};


exports.uploadFile = (req, res) => {
  upload.single("file")(req, res, async (err) => {
    if (err) return res.status(400).send(err.message);

    try {
      if (!req.file) {
        console.log("No file detected");
        return res.status(400).send("No file uploaded");
      }

      console.log("Uploaded File:", req.file);
      console.log("User ID:", req.user?.id);

      const folderId = req.params.id ? parseInt(req.params.id) : null;

      if (folderId) {
        const folder = await prisma.folder.findUnique({
          where: { id: folderId },
        });
        if (!folder) return res.status(404).send("Folder not found");
      }

      const newFile = await prisma.file.create({
        data: {
          filename: req.file.originalname,
          filetype: req.file.mimetype,
          filesize: req.file.size,
          filepath: req.file.path,
          userId: req.user.id,
          folderId: folderId,
        },
      });

      res.redirect(folderId ? `/folders/${folderId}` : "/");
    } catch (error) {
      console.error("Upload Error:", error);
      res.status(500).send("Error uploading file");
    }
  });
};

exports.deleteFile = async (req, res) => {
  const { fileId, folderId } = req.params;
  try {
    const file = await prisma.file.findUnique({
      where: { id: parseInt(fileId) },
    });

    if (!file) {
      return res.status(404).send("File not found");
    }

    // Check if the file is hosted on Cloudinary
    if (file.filepath.startsWith("https://res.cloudinary.com")) {
      // Extract the public ID from the file URL
      const publicId = file.filepath.split("/").pop().split(".")[0];

      // Delete the file from Cloudinary
      const cloudinaryResponse = await cloudinary.uploader.destroy(publicId);

      if (cloudinaryResponse.result === "ok") {
        // Delete file record from database after successful deletion from Cloudinary
        await prisma.file.delete({
          where: { id: parseInt(fileId) },
        });

        return res.status(200).send("File deleted successfully from Cloudinary");
      } else {
        return res.status(500).send("Error deleting file from Cloudinary");
      }
    } else {
      // For local files (not hosted on Cloudinary)
      const filePath = path.join(__dirname, "../", file.filepath.replace(/\\/g, "/"));
      fs.unlinkSync(filePath); // Delete the file locally

      await prisma.file.delete({
        where: { id: parseInt(fileId) },
      });

      return res.status(200).send("File deleted successfully");
    }
  } catch (error) {
    console.error("Error deleting file:", error);
    res.status(500).send("Error deleting file");
  }
};

