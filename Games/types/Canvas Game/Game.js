const Game = require("../../core/Game");
const Player = require("./Player");
const Queue = require("../../core/Queue");
const Winners = require("../../core/Winners");
const Random = require("../../../lib/Random");

module.exports = class CanvasGame extends Game {

	constructor(options) {
		super(options);

		this.type = options.gameName || "Canvas Game";
		this.Player = Player;
		this.states = [
			{
				name: "Postgame"
			},
			{
				name: "Pregame"
			},
			{
				name: "Turn",
				length: options.settings.stateLengths["Turn"] || Infinity,
			},
		];
	}

	checkWinConditions() {
		return [false, false];
	}

	getWinners() {
		var winQueue = new Queue();
		var winners = new Winners(this);

		for (let player of this.players)
			winQueue.enqueue(player.role.winCheck);

		for (let winCheck of winQueue) {
			let stop = winCheck.check(winners);
			if (stop) break;
		}

		winners.determinePlayers();
		return winners;
	}

}
