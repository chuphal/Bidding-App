import { StatusCodes } from "http-status-codes";
import pool from "../db/dbConfig.js";
import {
  BadRequestError,
  CustomAPIError,
  NotFoundError,
} from "../errors/index.js";
import { io, getReceiverSocketId } from "../socket/socket.js";
import { logger } from "../logger/logger.js";

export const getAllBids = async (req, res) => {
  try {
    const { itemId } = req.params;

    // check for item ...
    const isItem = await pool.query(
      `Select * FROM auction_items WHERE id =$1 `,
      [itemId]
    );

    if (isItem.rowCount === 0) {
      logger.error(`There is not item present with id: ${itemId}`);
      throw new NotFoundError(`There is not item present with id: ${itemId}`);
    }

    const totalBids = await pool.query(
      `SELECT * FROM bids WHERE item_id = $1 ORDER BY created_at DESC`,
      [itemId]
    );

    if (totalBids.rowCount === 0) {
      logger.info(
        `Currently, there are no bids regarding item having id: ${itemId}`
      );
      return res.status(StatusCodes.OK).json({
        bids: `Currently, there are no bids regarding item having id: ${itemId}`,
      });
    }
    logger.info("Successfully list all the bids");
    return res.status(StatusCodes.OK).json({ bids: totalBids.rows });
  } catch (error) {
    logger.error("Server error", error);
    throw new CustomAPIError("Server Error", StatusCodes.INTERNAL_SERVER_ERROR);
  }
};

export const createBid = async (req, res) => {
  const { itemId } = req.params;

  // take the user_id from jwt payload.
  const { userId, username, role } = req.user;
  const { bid_amount } = req.body;

  const isItemPresent = await pool.query(
    `SELECT * FROM auction_items WHERE id = $1`,
    [itemId]
  );

  if (isItemPresent.rowCount === 0) {
    logger.error(`No item exist with id: ${itemId}`);
    throw new BadRequestError(`No item exist with id: ${itemId}`);
  }
  // checking bid amount...
  const last_bid = isItemPresent.rows[0].current_price;
  // console.log(last_bid);
  if (last_bid >= bid_amount) {
    // 409 - req. not proccessed due to conflict
    logger.error(`Your bidding amount should be greater than ${last_bid}`);
    throw new CustomAPIError(
      `Your bidding amount should be greater than ${last_bid}`,
      StatusCodes.CONFLICT
    );
  }

  const ownerId = isItemPresent.rows[0].owner_id;
  // update the notification's to the owner of the item.
  if (ownerId && ownerId !== userId) {
    const ownerMsg = `Your item ${isItemPresent.rows[0].name} has received a new bid of ${bid_amount}`;

    await pool.query(
      `INSERT INTO notifications (user_id, message) VALUES ($1, $2)`,
      [ownerId, ownerMsg]
    );

    //**** */ web socket
    const receiverSocketId = getReceiverSocketId(ownerId);
    io.to(receiverSocketId).emit("notification", ownerMsg);
  }

  //notify to the last highest bidder..
  const highestBidResult = await pool.query(
    `SELECT * FROM bids WHERE item_id = $1 ORDER BY created_at DESC`,
    [itemId]
  );
  const highestBid = highestBidResult.rows[0];

  // console.log(highestBid);
  if (highestBid && highestBid.user_id !== userId) {
    const outbitMsg = `You have been outbid on item ${isItemPresent.rows[0].name}. The new highest bid is ${bid_amount}`;

    await pool.query(
      `INSERT INTO notifications (user_id, message) VALUES ($1, $2)`,
      [highestBid.user_id, outbitMsg]
    );
    // **** web socket.. implement...
    const receiverSocketId = getReceiverSocketId(highestBid.user_id);
    io.to(receiverSocketId).emit("notification", outbitMsg);
  }

  await pool.query(
    `INSERT INTO bids (item_id, user_id, bid_amount)
  VALUES ($1, $2, $3 )`,
    [itemId, userId, bid_amount]
  );

  // update the new bid to the item's current price..
  await pool.query(
    `
    UPDATE auction_itemS SET current_price = $1 WHERE id = $2
  `,
    [bid_amount, itemId]
  );

  logger.info("bid created successfully");
  res
    .status(StatusCodes.CREATED)
    .json({ bid_creator: username, msg: "bid created successfully" });
};
