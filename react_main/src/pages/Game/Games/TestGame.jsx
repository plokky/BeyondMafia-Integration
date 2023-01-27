import React from "react";

export class GameLogic {
	constructor(canvasRef) {
		this.gameCanvas = canvasRef;
	}

	get canvas() {
		return this.gameCanvas;
	}

	initDraw() {
		const ctx = this.gameCanvas.current.getContext("2d");
		ctx.font = "70px sans-serif"
		ctx.fillText("Test", 10, 100);
	}

	startGame() {
		const ctx = this.gameCanvas.current.getContext("2d");
	}

	handleUpdate() {
	}
}
