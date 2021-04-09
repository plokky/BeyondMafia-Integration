const express = require("express");
const shortid = require("shortid");
const constants = require("../constants");
const models = require("../db/models");
const routeUtils = require("./utils");
const redis = require("../redis");
const logger = require("../logging")(".");
const router = express.Router();

router.get("/groups", async function (req, res) {
	res.setHeader("Content-Type", "application/json");
	try {
		var visibleGroups = await models.Group.find({ visible: true })
			.select("name rank");
		visibleGroups = visibleGroups.map(group => group.toJSON());

		for (let group of visibleGroups) {
			group.members = await models.InGroup.find({ group: group._id })
				.select("user")
				.populate("user", "id name avatar -_id");
			group.members = group.members.map(member => member.toJSON().user);

			for (let member of group.members)
				member.status = await redis.getUserStatus(member.id);

			delete group._id;
		}

		res.send(visibleGroups);
	}
	catch (e) {
		logger.error(e);
		res.status(500);
		res.send("Error loading groups.");
	}
});

router.get("/groupPerms", async function (req, res) {
	res.setHeader("Content-Type", "application/json");
	try {
		var userId = await routeUtils.verifyLoggedIn(req);
		var perm = "viewPerms";

		if (!(await routeUtils.verifyPermission(res, userId, perm)))
			return;

		var name = routeUtils.capitalizeWords(String(req.query.name));
		var group = await models.Group.findOne({ name: name })
			.select("permissions");

		if (!group) {
			res.status(500);
			res.send("Group does not exist.");
			return;
		}

		res.send(group.permissions);
	}
	catch (e) {
		logger.error(e);
		res.status(500);
		res.send("Error getting permissions.");
	}
});

router.get("/userPerms", async function (req, res) {
	res.setHeader("Content-Type", "application/json");
	try {
		var userId = await routeUtils.verifyLoggedIn(req);
		var perm = "viewPerms";

		if (!(await routeUtils.verifyPermission(res, userId, perm)))
			return;

		var userIdToGet = String(req.query.userId);
		var permInfo = await redis.getUserPermissions(userIdToGet);

		if (permInfo.noUser) {
			res.status(500);
			res.send("User does not exist.");
			return;
		}

		res.send(Object.keys(permInfo.perms));
	}
	catch (e) {
		logger.error(e);
		res.status(500);
		res.send("Error getting permissions.");
	}
});

router.post("/group", async function (req, res) {
	try {
		var userId = await routeUtils.verifyLoggedIn(req);
		var name = routeUtils.capitalizeWords(String(req.body.name));
		var rank = Number(req.body.rank);
		var perm = "createGroup";

		if (!(await routeUtils.verifyPermission(res, userId, perm, rank + 1)))
			return;

		var permissions = req.body.permissions || [];

		if (!name.match(/^([a-zA-Z]+)( [a-zA-Z]+)*$/)) {
			res.status(500);
			res.send("Group names can only contain letters and spaces.");
			return;
		}

		if (!Array.isArray(permissions)) {
			res.status(500);
			res.send("Bad permission format");
			return;
		}

		permissions = permissions.map(perm => String(perm));

		for (let perm of permissions) {
			if (!constants.allPerms[perm]) {
				res.status(500);
				res.send(`"${perm}" is not a valid permission.`);
				return;
			}
		}

		var existingGroup = await models.Group.findOne({ name: name })
			.select("_id");

		if (existingGroup) {
			res.status(500);
			res.send("A group with this name already exists.");
			return;
		}

		var group = new models.Group({
			id: shortid.generate(),
			name,
			rank,
			permissions
		});
		await group.save();

		res.sendStatus(200);
	}
	catch (e) {
		logger.error(e);
		res.status(500);
		res.send("Error creating group.");
	}
});

router.post("/group/delete", async function (req, res) {
	try {
		var userId = await routeUtils.verifyLoggedIn(req);
		var name = routeUtils.capitalizeWords(String(req.body.name));
		var perm = "deleteGroup";

		var group = await models.Group.findOne({ name: name })
			.select("id rank");

		if (!group) {
			res.status(500);
			res.send("Group not found.");
			return;
		}

		if (!(await routeUtils.verifyPermission(res, userId, perm, group.rank + 1)))
			return;

		var members = await models.InGroup.find({ group: group._id })
			.select("user")
			.populate("user", "id");
		members = members.map(m => m.user.id);

		await models.Group.deleteOne({ id: group.id }).exec();
		await models.InGroup.deleteMany({ group: group._id }).exec();

		for (let member of members)
			await redis.cacheUserPermissions(member);

		res.sendStatus(200);
	}
	catch (e) {
		logger.error(e);
		res.status(500);
		res.send("Error deleting group.");
	}
});


router.post("/groupPerms", async function (req, res) {
	try {
		var userId = await routeUtils.verifyLoggedIn(req);
		var groupName = routeUtils.capitalizeWords(String(req.body.groupName));
		var perm = "updateGroupPerms";

		var group = await models.Group.findOne({ name: groupName })
			.select("rank");

		if (!group) {
			res.status(500);
			res.send("Group does not exist.");
			return;
		}

		if (!(await routeUtils.verifyPermission(res, userId, perm, group.rank + 1)))
			return;

		var addPermissions = req.body.addPermissions || [];
		var removePermissions = req.body.removePermissions || [];

		if (!Array.isArray(addPermissions) || !Array.isArray(removePermissions)) {
			res.status(500);
			res.send("Bad permission format");
			return;
		}

		addPermissions = addPermissions.map(perm => String(perm)).filter(p => p.length > 0);
		removePermissions = removePermissions.map(perm => String(perm)).filter(p => p.length > 0);

		var userPermissionInfo = await redis.getUserPermissions(userId);
		var userPermissions = userPermissionInfo.perms;
		var userRank = userPermissionInfo.rank;

		for (let perm of addPermissions.concat(removePermissions)) {
			if (
				userRank < Infinity && (
					!userPermissions[perm] ||
					constants.protectedPerms.indexOf(perm) != -1
				)
			) {
				res.status(500);
				res.send(`You cannot grant the ${perm} permission.`);
				return;
			}

			if (!constants.allPerms[perm]) {
				res.status(500);
				res.send(`"${perm}" is not a valid permission.`);
				return;
			}
		}

		await models.Group.updateOne(
			{ name: groupName },
			{
				$push: {
					permissions: {
						$each: addPermissions
					}
				}
			}
		).exec();

		await models.Group.updateOne(
			{ name: groupName },
			{
				$pull: {
					permissions: {
						$in: removePermissions
					}
				}
			}
		).exec();

		await redis.cacheUserPermissions(userId);
		res.sendStatus(200);
	}
	catch (e) {
		logger.error(e);
		res.status(500);
		res.send("Error updating group permissions.");
	}
});

router.post("/addToGroup", async function (req, res) {
	try {
		var userId = await routeUtils.verifyLoggedIn(req);
		var groupName = routeUtils.capitalizeWords(String(req.body.groupName));
		var userIdToAdd = String(req.body.userId);
		var perm = "giveGroup";

		var group = await models.Group.findOne({ name: groupName })
			.select("rank");

		if (!group) {
			res.status(500);
			res.send("Group does not exist.");
			return;
		}

		if (!(await routeUtils.verifyPermission(res, userId, perm, group.rank + 1)))
			return;

		var userToAdd = await models.User.findOne({ id: userIdToAdd, deleted: false })
			.select("_id");

		if (!userToAdd) {
			res.status(500);
			res.send("User does not exist.");
			return;
		}

		var inGroup = await models.InGroup.findOne({ user: userToAdd._id, group: group._id });

		if (inGroup) {
			res.status(500);
			res.send("User is already in this group.");
			return;
		}

		inGroup = new models.InGroup({
			user: userToAdd._id,
			group: group._id
		});
		await inGroup.save();
		await redis.cacheUserPermissions(userIdToAdd);

		res.sendStatus(200);
	}
	catch (e) {
		logger.error(e);
		res.status(500);
		res.send("Error adding user to group.");
	}
});

router.post("/removeFromGroup", async function (req, res) {
	try {
		var userId = await routeUtils.verifyLoggedIn(req);
		var groupName = routeUtils.capitalizeWords(String(req.body.groupName));
		var userIdToRemove = String(req.body.userId);
		var perm = "removeFromGroup";

		var group = await models.Group.findOne({ name: groupName })
			.select("rank");

		if (!group) {
			res.status(500);
			res.send("Group does not exist.");
			return;
		}

		if (!(await routeUtils.verifyPermission(res, userId, perm, group.rank + 1)))
			return;

		var userToRemove = await models.User.findOne({ id: userIdToRemove, deleted: false })
			.select("_id");

		if (!userToRemove) {
			res.status(500);
			res.send("User does not exist.");
			return;
		}

		await models.InGroup.deleteOne({ user: userToRemove._id, group: group._id }).exec();
		await redis.cacheUserPermissions(userIdToRemove);

		res.sendStatus(200);
	}
	catch (e) {
		logger.error(e);
		res.status(500);
		res.send("Error adding user to group.");
	}
});

router.post("/forumBan", async (req, res) => {
	try {
		var userId = await routeUtils.verifyLoggedIn(req);
		var userIdToBan = String(req.body.userId);
		var length = String(req.body.length);
		var perm = "forumBan";
		var banRank = await redis.getUserRank(userIdToBan);

		if (banRank == null) {
			res.status(500);
			res.send("User does not exist.");
			return;
		}

		if (!(await routeUtils.verifyPermission(res, userId, perm, banRank + 1)))
			return;

		length = routeUtils.parseTime(length);

		if (length == null) {
			res.status(500);
			res.send("Invalid time string. Must have the format 'length unit', e.g. '1 hour'.");
			return;
		}

		if (length < 1000 * 60 * 60) {
			res.status(500);
			res.send("Minimum ban time is 1 hour.");
			return;
		}

		await routeUtils.banUser(
			userIdToBan,
			length,
			["vote", "createThread", "postReply", "deleteOwnPost", "editPost"],
			"forum",
			userId
		);

		await routeUtils.createNotification({
			content: `You have been banned from the forums for ${routeUtils.timeDisplay(length)}.`,
			icon: "ban"
		}, [userIdToBan]);

		res.sendStatus(200);
	}
	catch (e) {
		logger.error(e);
		res.status(500);
		res.send("Error forum banning user.");
	}
});

router.post("/chatBan", async (req, res) => {
	try {
		var userId = await routeUtils.verifyLoggedIn(req);
		var userIdToBan = String(req.body.userId);
		var length = String(req.body.length);
		var perm = "chatBan";
		var banRank = await redis.getUserRank(userIdToBan);

		if (banRank == null) {
			res.status(500);
			res.send("User does not exist.");
			return;
		}

		if (!(await routeUtils.verifyPermission(res, userId, perm, banRank + 1)))
			return;

		length = routeUtils.parseTime(length);

		if (length == null) {
			res.status(500);
			res.send("Invalid time string. Must have the format 'length unit', e.g. '1 hour'.");
			return;
		}

		if (length < 1000 * 60 * 60) {
			res.status(500);
			res.send("Minimum ban time is 1 hour.");
			return;
		}

		await routeUtils.banUser(
			userIdToBan,
			length,
			["publicChat", "privateChat"],
			"chat",
			userId
		);

		await routeUtils.createNotification({
			content: `You have been banned from chat for ${routeUtils.timeDisplay(length)}.`,
			icon: "ban"
		}, [userIdToBan]);

		res.sendStatus(200);
	}
	catch (e) {
		logger.error(e);
		res.status(500);
		res.send("Error chat banning user.");
	}
});

router.post("/gameBan", async (req, res) => {
	try {
		var userId = await routeUtils.verifyLoggedIn(req);
		var userIdToBan = String(req.body.userId);
		var length = String(req.body.length);
		var perm = "gameBan";
		var banRank = await redis.getUserRank(userIdToBan);

		if (banRank == null) {
			res.status(500);
			res.send("User does not exist.");
			return;
		}

		if (!(await routeUtils.verifyPermission(res, userId, perm, banRank + 1)))
			return;

		length = routeUtils.parseTime(length);

		if (length == null) {
			res.status(500);
			res.send("Invalid time string. Must have the format 'length unit', e.g. '1 hour'.");
			return;
		}

		if (length < 1000 * 60 * 60) {
			res.status(500);
			res.send("Minimum ban time is 1 hour.");
			return;
		}

		await routeUtils.banUser(
			userIdToBan,
			length,
			["playGame"],
			"game",
			userId
		);

		await routeUtils.createNotification({
			content: `You have been banned from games for ${routeUtils.timeDisplay(length)}.`,
			icon: "ban"
		}, [userIdToBan]);

		res.sendStatus(200);
	}
	catch (e) {
		logger.error(e);
		res.status(500);
		res.send("Error game banning user.");
	}
});

router.post("/hostRankedBan", async (req, res) => {
	try {
		var userId = await routeUtils.verifyLoggedIn(req);
		var userIdToBan = String(req.body.userId);
		var length = String(req.body.length);
		var perm = "hostRankedBan";
		var banRank = await redis.getUserRank(userIdToBan);

		if (banRank == null) {
			res.status(500);
			res.send("User does not exist.");
			return;
		}

		if (!(await routeUtils.verifyPermission(res, userId, perm, banRank + 1)))
			return;

		length = routeUtils.parseTime(length);

		if (length == null) {
			res.status(500);
			res.send("Invalid time string. Must have the format 'length unit', e.g. '1 hour'.");
			return;
		}

		if (length < 1000 * 60 * 60) {
			res.status(500);
			res.send("Minimum ban time is 1 hour.");
			return;
		}

		await routeUtils.banUser(
			userIdToBan,
			length,
			["hostRanked"],
			"hostRanked",
			userId
		);

		await routeUtils.createNotification({
			content: `You have been banned from hosting ranked games for ${routeUtils.timeDisplay(length)}.`,
			icon: "ban"
		}, [userIdToBan]);

		res.sendStatus(200);
	}
	catch (e) {
		logger.error(e);
		res.status(500);
		res.send("Error game banning user.");
	}
});

router.post("/siteBan", async (req, res) => {
	try {
		var userId = await routeUtils.verifyLoggedIn(req);
		var userIdToBan = String(req.body.userId);
		var length = String(req.body.length);
		var perm = "siteBan";
		var banRank = await redis.getUserRank(userIdToBan);

		if (banRank == null) {
			res.status(500);
			res.send("User does not exist.");
			return;
		}

		if (!(await routeUtils.verifyPermission(res, userId, perm, banRank + 1)))
			return;

		length = routeUtils.parseTime(length);

		if (length == null) {
			res.status(500);
			res.send("Invalid time string. Must have the format 'length unit', e.g. '1 hour'.");
			return;
		}

		if (length < 1000 * 60 * 60) {
			res.status(500);
			res.send("Minimum ban time is 1 hour.");
			return;
		}

		await routeUtils.banUser(
			userIdToBan,
			length,
			["signIn"],
			"site",
			userId
		);

		await models.Session.deleteMany({ "session.passport.user.id": userIdToBan }).exec();

		res.sendStatus(200);
	}
	catch (e) {
		logger.error(e);
		res.status(500);
		res.send("Error site banning user.");
	}
});

router.post("/signOut", async (req, res) => {
	try {
		var userId = await routeUtils.verifyLoggedIn(req);
		var userIdToActOn = String(req.body.userId);
		var perm = "forceSignOut";
		var rank = await redis.getUserRank(userIdToActOn);

		if (rank == null) {
			res.status(500);
			res.send("User does not exist.");
			return;
		}

		if (!(await routeUtils.verifyPermission(res, userId, perm, rank + 1)))
			return;

		await models.Session.deleteMany({ "session.passport.user.id": userIdToActOn }).exec();
		res.sendStatus(200);
	}
	catch (e) {
		logger.error(e);
		res.status(500);
		res.send("Error game banning user.");
	}
});

router.post("/forumUnban", async (req, res) => {
	try {
		var userId = await routeUtils.verifyLoggedIn(req);
		var userIdToActOn = String(req.body.userId);
		var perm = "forumUnban";
		var rank = await redis.getUserRank(userIdToActOn);

		if (rank == null) {
			res.status(500);
			res.send("User does not exist.");
			return;
		}

		if (!(await routeUtils.verifyPermission(res, userId, perm, rank + 1)))
			return;

		await models.Ban.deleteMany({ userId: userIdToActOn, type: "forum", auto: false }).exec();
		await redis.cacheUserPermissions(userIdToActOn);

		res.sendStatus(200);
	}
	catch (e) {
		logger.error(e);
		res.status(500);
		res.send("Error forum unbanning user.");
	}
});

router.post("/chatUnban", async (req, res) => {
	try {
		var userId = await routeUtils.verifyLoggedIn(req);
		var userIdToActOn = String(req.body.userId);
		var perm = "chatUnban";
		var rank = await redis.getUserRank(userIdToActOn);

		if (rank == null) {
			res.status(500);
			res.send("User does not exist.");
			return;
		}

		if (!(await routeUtils.verifyPermission(res, userId, perm, rank + 1)))
			return;

		await models.Ban.deleteMany({ userId: userIdToActOn, type: "chat", auto: false }).exec();
		await redis.cacheUserPermissions(userIdToActOn);

		res.sendStatus(200);
	}
	catch (e) {
		logger.error(e);
		res.status(500);
		res.send("Error chat unbanning user.");
	}
});

router.post("/gameUnban", async (req, res) => {
	try {
		var userId = await routeUtils.verifyLoggedIn(req);
		var userIdToActOn = String(req.body.userId);
		var perm = "gameUnban";
		var rank = await redis.getUserRank(userIdToActOn);

		if (rank == null) {
			res.status(500);
			res.send("User does not exist.");
			return;
		}

		if (!(await routeUtils.verifyPermission(res, userId, perm, rank + 1)))
			return;

		await models.Ban.deleteMany({ userId: userIdToActOn, type: "game", auto: false }).exec();
		await redis.cacheUserPermissions(userIdToActOn);

		res.sendStatus(200);
	}
	catch (e) {
		logger.error(e);
		res.status(500);
		res.send("Error game unbanning user.");
	}
});

router.post("/siteUnban", async (req, res) => {
	try {
		var userId = await routeUtils.verifyLoggedIn(req);
		var userIdToActOn = String(req.body.userId);
		var perm = "siteUnban";
		var rank = await redis.getUserRank(userIdToActOn);

		if (rank == null) {
			res.status(500);
			res.send("User does not exist.");
			return;
		}

		if (!(await routeUtils.verifyPermission(res, userId, perm, rank + 1)))
			return;

		await models.Ban.deleteMany({ userId: userIdToActOn, type: "site", auto: false }).exec();
		await redis.cacheUserPermissions(userIdToActOn);

		res.sendStatus(200);
	}
	catch (e) {
		logger.error(e);
		res.status(500);
		res.send("Error site unbanning user.");
	}
});

router.get("/alts", async (req, res) => {
	res.setHeader("Content-Type", "application/json");
	try {
		var userId = await routeUtils.verifyLoggedIn(req);
		var userIdToActOn = String(req.query.userId);
		var perm = "viewAlts";

		if (!(await routeUtils.verifyPermission(res, userId, perm)))
			return;

		var user = await models.User.findOne({ id: userIdToActOn/*, deleted: false*/ })
			.select("ip");

		if (!user) {
			res.status(500);
			res.send("User does not exist.");
			return;
		}

		var ips = user.ip;
		var users = await models.User.find({ ip: { $elemMatch: { $in: ips } } })
			.select("name");
		users = users.map(u => u.name);

		res.send(users);
	}
	catch (e) {
		logger.error(e);
		res.status(500);
		res.send("Error loading alt accounts.");
	}
});

router.get("/bans", async (req, res) => {
	res.setHeader("Content-Type", "application/json");
	try {
		var userId = await routeUtils.verifyLoggedIn(req);
		var userIdToActOn = String(req.query.userId);
		var perm = "viewBans";

		if (!(await routeUtils.verifyPermission(res, userId, perm)))
			return;

		var user = await models.User.findOne({ id: userIdToActOn, deleted: false })
			.select("_id");

		if (!user) {
			res.status(500);
			res.send("User does not exist.");
			return;
		}

		var bans = await models.Ban.find({ userId: userIdToActOn, auto: false })
			.select("type expires modId -_id");

		res.send(bans);
	}
	catch (e) {
		logger.error(e);
		res.status(500);
		res.send("Error loading alt accounts.");
	}
});

router.post("/clearSetupName", async (req, res) => {
	res.setHeader("Content-Type", "application/json");
	try {
		var userId = await routeUtils.verifyLoggedIn(req);
		var setupId = String(req.body.setupId);
		var perm = "clearSetupName";

		if (!(await routeUtils.verifyPermission(res, userId, perm)))
			return;

		await models.Setup.updateOne(
			{ id: setupId },
			{ $set: { name: `Setup ${setupId}` } }
		).exec();

		res.sendStatus(200);
	}
	catch (e) {
		logger.error(e);
		res.status(500);
		res.send("Error clearing setup name.");
	}
});

router.post("/clearBio", async (req, res) => {
	res.setHeader("Content-Type", "application/json");
	try {
		var userId = await routeUtils.verifyLoggedIn(req);
		var userIdToClear = String(req.body.userId);
		var perm = "clearBio";

		if (!(await routeUtils.verifyPermission(res, userId, perm)))
			return;

		await models.User.updateOne(
			{ id: userIdToClear },
			{ $set: { bio: "" } }
		).exec();

		res.sendStatus(200);
	}
	catch (e) {
		logger.error(e);
		res.status(500);
		res.send("Error clearing bio.");
	}
});
router.post("/clearAvi", async (req, res) => {
	res.setHeader("Content-Type", "application/json");
	try {
		var userId = await routeUtils.verifyLoggedIn(req);
		var userIdToClear = String(req.body.userId);
		var perm = "clearAvi";

		if (!(await routeUtils.verifyPermission(res, userId, perm)))
			return;

		await models.User.updateOne(
			{ id: userIdToClear },
			{ $set: { avatar: false } }
		).exec();

		res.sendStatus(200);
	}
	catch (e) {
		logger.error(e);
		res.status(500);
		res.send("Error clearing avatar.");
	}
});

router.post("/clearAccountDisplay", async (req, res) => {
	res.setHeader("Content-Type", "application/json");
	try {
		var userId = await routeUtils.verifyLoggedIn(req);
		var userIdToClear = String(req.body.userId);
		var perm = "clearAccountDisplay";

		if (!(await routeUtils.verifyPermission(res, userId, perm)))
			return;

		await models.User.updateOne(
			{ id: userIdToClear },
			{
				$set: {
					"settings.showDiscord": false,
					"settings.showTwitch": false,
					"settings.showGoogle": false,
					"settings.showSteam": false,
				}
			}
		).exec();

		res.sendStatus(200);
	}
	catch (e) {
		logger.error(e);
		res.status(500);
		res.send("Error clearing account display.");
	}
});

router.post("/clearName", async (req, res) => {
	try {
		var userId = await routeUtils.verifyLoggedIn(req);
		var userIdToClear = String(req.body.userId);
		var perm = "clearName";

		if (!(await routeUtils.verifyPermission(res, userId, perm)))
			return;

		await models.User.updateOne(
			{ id: userIdToClear },
			{ $set: { name: routeUtils.nameGen().slice(0, constants.maxUserNameLength) } }
		).exec();

		res.sendStatus(200);
	}
	catch (e) {
		logger.error(e);
		res.status(500);
		res.send("Error clearing username.");
	}
});

router.post("/clearAllContent", async (req, res) => {
	try {
		var userId = await routeUtils.verifyLoggedIn(req);
		var userIdToClear = String(req.body.userId);
		var perm = "clearAllUserContent";

		if (!(await routeUtils.verifyPermission(res, userId, perm)))
			return;

		var user = await models.User.findOne({ id: userIdToClear })
			.select("_id");

		if (!user) {
			res.status(500);
			res.send("User not found.");
			return;
		}

		await models.User.updateOne(
			{ id: userIdToClear },
			{
				$set: {
					name: routeUtils.nameGen().slice(0, constants.maxUserNameLength),
					avatar: false,
					bio: "",
					"settings.showDiscord": false,
					"settings.showTwitch": false,
					"settings.showGoogle": false,
					"settings.showSteam": false,
				}
			}
		).exec();

		await models.Setup.updateMany(
			{ creator: user._id },
			{ $set: { name: "Unnamed setup" } }
		).exec();

		await models.ForumThread.updateMany(
			{ author: user._id },
			{ $set: { deleted: true } }
		).exec();

		await models.ForumReply.updateMany(
			{ author: user._id },
			{ $set: { deleted: true } }
		).exec();

		await models.Comment.updateMany(
			{ author: user._id },
			{ $set: { deleted: true } }
		).exec();

		await models.ChatMessage.deleteMany({ senderId: userIdToClear }).exec();

		res.sendStatus(200);
	}
	catch (e) {
		logger.error(e);
		res.status(500);
		res.send("Error clearing user's content.");
	}
});

router.post("/breakGame", async (req, res) => {
	try {
		var userId = await routeUtils.verifyLoggedIn(req);
		var gameToClear = String(req.body.gameId);
		var perm = "breakGame";

		if (!(await routeUtils.verifyPermission(res, userId, perm)))
			return;

		await redis.breakGame(gameToClear);
		res.sendStatus(200);
	}
	catch (e) {
		logger.error(e);
		res.status(500);
		res.send("Error clearing username.");
	}
});

router.post("/clearAllIPs", async (req, res) => {
	try {
		var userId = await routeUtils.verifyLoggedIn(req);
		var perm = "clearAllIPs";

		if (!(await routeUtils.verifyPermission(res, userId, perm)))
			return;

		await models.User.updateMany({}, { $unset: { ip: "" } }).exec();
		res.sendStatus(200);
	}
	catch (e) {
		logger.error(e);
		res.status(500);
		res.send("Error clearing IPs.");
	}
});

router.post("/giveCoins", async (req, res) => {
	try {
		var userId = await routeUtils.verifyLoggedIn(req);
		var userIdToGiveTo = String(req.body.userId);
		var amount = Number(req.body.amount);
		var perm = "giveCoins";

		if (!(await routeUtils.verifyPermission(res, userId, perm)))
			return;

		await models.User.updateOne(
			{ id: userIdToGiveTo },
			{ $inc: { coins: amount } }
		).exec();


		await redis.cacheUserInfo(userIdToGiveTo, true);
		res.sendStatus(200);
	}
	catch (e) {
		logger.error(e);
		res.status(500);
		res.send("Error giving coins.");
	}
});

router.post("/changeName", async (req, res) => {
	try {
		var userId = await routeUtils.verifyLoggedIn(req);
		var userIdToChange = String(req.body.userId);
		var name = Number(req.body.name);
		var perm = "changeName";

		if (!(await routeUtils.verifyPermission(res, userId, perm)))
			return;

		await models.User.updateOne(
			{ id: userIdToChange },
			{ $set: { name: name } }
		).exec();

		await redis.cacheUserInfo(userIdToChange, true);
		res.sendStatus(200);
	}
	catch (e) {
		logger.error(e);
		res.status(500);
		res.send("Error changing name.");
	}
});

module.exports = router;