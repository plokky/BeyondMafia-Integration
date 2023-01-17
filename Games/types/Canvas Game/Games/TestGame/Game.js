const Game = require("../../Game");

module.exports = class TestGame extends Game {

	constructor(options) {
		super(Object.assign( {}, options, {
			"type": "Test Game"
		}));

		this.gameName = "Test Game";
	}

	getSetupInfo() {
		return {
			"name"           : this.gameName,
			"gameType"       : "Canvas Game",
			"whispers"       : false,
			"leakPercentage" : 0,
			"minPlayers"     : 2,
			"maxPlayers"     : 2,
		}
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
