import pool from "../db/dbConfig.js";
import { BadRequestError } from "../errors/bad-request.js";
import bcrypt from "bcryptjs";
import generateTokenAndSetCookie from "../utils/generateToken.js";
import { StatusCodes } from "http-status-codes";
import { NotFoundError } from "../errors/not-found.js";
import jwt from "jsonwebtoken";
import transporter from "../nodemailer/mailerConfig.js";

import { CustomAPIError } from "../errors/custom-api.js";
import { logger } from "../logger/logger.js";

export const register = async (req, res) => {
  const { username, password, email, role } = req.body;

  if (!username || !email || !password) {
    logger.error("Please provide  name, email and password");
    throw new BadRequestError("Please provide  name, email and password");
  }
  if (password.length < 6) {
    logger.error("Password should be at least 6 charaters");
    throw new BadRequestError("Password should be at least 6 charaters");
  }

  let rerole = role;
  if (!role) {
    rerole = "user";
  }

  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(password, salt);

  try {
    const user = await pool.query(
      `INSERT INTO users (username, password, email, role) VALUES ($1, $2, $3, $4)
      RETURNING id,username, role`,
      [username, hashedPassword, email, rerole]
    );

    generateTokenAndSetCookie(
      {
        userId: user.rows[0].id,
        username: user.rows[0].username,
        role: user.rows[0].role,
      },
      res
    );
    logger.info("Registered successfully");
    // const token = req.cookie.jwt;
    res
      .status(StatusCodes.CREATED)
      .json({ msg: "Registered successfully", user: user.rows[0] });
  } catch (error) {
    logger.error(
      "User already exist,please provide unique name, email and password",
      error
    );
    throw new BadRequestError(
      "User already exist,please provide unique name, email and password"
    );
  }
};

export const login = async (req, res) => {
  const { username, password } = req.body;

  const user = await pool.query("SELECT * FROM users WHERE username = $1", [
    username,
  ]);
  if (user.rowCount === 0) {
    logger.error("Invalid username or password");
    throw new BadRequestError("Invalid username or password");
  }
  const encryptPassword = user.rows[0].password;
  const isPasswordCorrect = await bcrypt.compare(
    password,
    encryptPassword || ""
  );

  if (!user || !isPasswordCorrect) {
    logger.error("Invalid username or password");
    throw new BadRequestError("Invalid username or password");
  }

  generateTokenAndSetCookie(
    {
      userId: user.rows[0].id,
      username: user.rows[0].username,
      rerole: user.rows[0].role,
    },
    res
  );

  logger.info("Login successfully");
  // const token = req.cookie.jwt;
  res
    .status(StatusCodes.OK)
    .json({ msg: "Login successfully", user: user.rows[0] });
};

export const logout = (req, res) => {
  try {
    res.cookie("jwt", "", { maxAge: 0 });
    logger.info("Logged out successfully");
    res.status(StatusCodes.OK).json({ msg: "Logged out successfully" });
  } catch (error) {
    logger.error("Error in logout controller", error);
    throw new CustomAPIError("Server Error", StatusCodes.INTERNAL_SERVER_ERROR);
  }
};

export const passwordReset = async (req, res) => {
  const { email } = req.body;

  const result = await pool.query("SELECT * FROM users WHERE email = $1", [
    email,
  ]);

  if (result.rows.length === 0) {
    logger.error("Email not found");
    throw new NotFoundError("Email not found");
  }

  const user = result.rows[0];
  const resetToken = jwt.sign({ id: user.id }, process.env.JWT_SECRET, {
    expiresIn: "1h",
  });
  const resetTokenExpires = new Date(Date.now() + 3600000); // 1 hr limit

  await pool.query(
    "UPDATE users SET reset_token = $1, reset_token_expires = $2 WHERE id = $3",
    [resetToken, resetTokenExpires, user.id]
  );

  const resetLink = `http://localhost:${process.env.PORT}/api/v1/users/reset-password/${resetToken}`;

  try {
    const mailOptions = {
      from: process.env.SERVICE_EMAIL,
      to: user.email,
      subject: "Password Reset",
      text: `Click the following link to reset your password: ${resetLink}`,
    };

    await transporter.sendMail(mailOptions);

    logger.info(`Reset link has been sent. Please check your email. .`);
    res.status(StatusCodes.OK).json({
      msg: `Reset link has been sent. Please check your email. .`,
      resetToken,
    });
  } catch (error) {
    logger.error("Error while sending mail", error);
    throw new CustomAPIError(
      "Error while sending mail",
      StatusCodes.INTERNAL_SERVER_ERROR
    );
  }
};

export const passwordResetToken = async (req, res) => {
  const { token } = req.params;

  const { newPassword } = req.body;

  if (!newPassword) {
    logger.error("Please enter password");
    throw new BadRequestError("Please enter password");
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const { id } = payload;

    const result = await pool.query(
      `SELECT * FROM users WHERE id = $1 AND reset_token= $2 AND reset_token_expires > $3`,
      [id, token, new Date()]
    );

    if (result.rowCount === 0) {
      logger.error("Invalid or expired token");
      throw new BadRequestError("Invalid or expired token");
    }

    const salt = await bcrypt.genSalt(10);

    const hashedPassword = await bcrypt.hash(newPassword, salt);

    // console.log(newPassword);
    await pool.query(
      `UPDATE users SET password = $1, reset_token = null, reset_token_expires=null WHERE id = $2`,
      [hashedPassword, id]
    );
    logger.info("Password updated successfully");
    res.status(StatusCodes.OK).json({ msg: "Password updated successfully" });
  } catch (error) {
    logger.error("Server Error"), error;
    throw new CustomAPIError("Server Error", StatusCodes.INTERNAL_SERVER_ERROR);
  }
};

export const profile = async (req, res) => {
  try {
    const { userId, username, role } = req.user;

    const items = await pool.query(
      `SELECT * FROM auction_items WHERE owner_id = $1`,
      [userId]
    );

    const bids = await pool.query(`SELECT * FROM bids WHERE user_id = $1`, [
      userId,
    ]);

    const notification = await pool.query(
      `SELECT * FROM notifications WHERE user_id = $1`,
      [userId]
    );

    logger.info("Successfully viewed profile");
    res.status(StatusCodes.OK).json({
      auctionItemsCount: items.rowCount,
      auctionItems: items.rows,
      bidsCount: bids.rowCount,
      bids: bids.rows,
      notificationCount: notification.rowCount,
      notifications: notification.rows,
    });
  } catch (error) {
    logger.error("server error", error);
    throw new CustomAPIError("Server Error", StatusCodes.INTERNAL_SERVER_ERROR);
  }
};
