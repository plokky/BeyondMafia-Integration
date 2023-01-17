import React, { useEffect } from "react";

import "../../../css/learn.css"

export default function LearnSplitDecision(props) {
	const gameType = "Canvas Game";

	useEffect(() => {
		document.title = "Learn Games | BeyondMafia";
	}, []);

	return (
		<div className="span-panel main">
			<div className="learn">
				<div className="heading">
					Synopsis
				</div>
				<div className="paragraphs">
					<div className="paragraph">
						These are games. For fun.
					</div>
				</div>
				<div className="heading">
					Games
				</div>
			</div>
		</div>
	);
}

