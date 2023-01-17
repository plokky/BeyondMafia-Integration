import React, { useRef, useEffect, useContext } from "react";

import { useSocketListeners, useStateViewingReducer, ThreePanelLayout, TopBar, TextMeetingLayout, ActionList, PlayerList, LastWillEntry, Timer, SpeechFilter, Notes } from "./Game";
import { GameContext } from "../../Contexts";

export default function CanvasGame() {
	const game = useContext(GameContext);

	const history = game.history;
	const updateHistory = game.updateHistory;
	const updatePlayers = game.updatePlayers;
	const stateViewing = game.stateViewing;
	const updateStateViewing = game.updateStateViewing;
	const self = game.self;
	const players = game.players;
	const isSpectator = game.isSpectator;

	const playBellRef = useRef(false);

	const gameType = "Games";
	const meetings = history.states[stateViewing] ? history.states[stateViewing].meetings : {};
	const stateEvents = history.states[stateViewing] ? history.states[stateViewing].stateEvents : [];
	const stateNames = ["Day", "Night", "Sunset"];
	const audioFileNames = ["gunshot"];
	const audioLoops = [false];
	const audioOverrides = [false];
	const audioVolumes = [0];

	// Make player view current state when it changes
	useEffect(() => {
		updateStateViewing({ type: "current" });
	}, [history.currentState]);

	useEffect(() => {
		game.loadAudioFiles(audioFileNames, audioLoops, audioOverrides, audioVolumes);

		// Make game review start at pregame
		if (game.review)
			updateStateViewing({ type: "first" });
	}, []);

	useSocketListeners(socket => {
		socket.on("state", state => {
			if (playBellRef.current)
				game.playAudio("bell");

			playBellRef.current = true;
		});
	}, game.socket);

	const canvas = <canvas className="game-canvas"></canvas>;

	return (
		<>
			<TopBar
				gameType={gameType}
				setup={game.setup}
				history={history}
				stateViewing={stateViewing}
				updateStateViewing={updateStateViewing}
				players={players}
				socket={game.socket}
				options={game.options}
				spectatorCount={game.spectatorCount}
				setLeave={game.setLeave}
				finished={game.finished}
				review={game.review}
				setShowSettingsModal={game.setShowSettingsModal}
				setRehostId={game.setRehostId}
				noLeaveRef={game.noLeaveRef}
				dev={game.dev}
				gameName={
					<div className="game-name">
						<span>M</span>afia
					</div>
				}
				timer={
					<Timer
						timers={game.timers}
						history={history} />
				} />
			<ThreePanelLayout
				leftPanelContent={
					<>
						<PlayerList
							players={players}
							history={history}
							gameType={gameType}
							stateViewing={stateViewing}
							activity={game.activity} />
						<SpeechFilter
							filters={game.speechFilters}
							setFilters={game.setSpeechFilters}
							stateViewing={stateViewing} />
					</>
				}
				centerPanelContent={

				}
				rightPanelContent={
					<>
						<TextMeetingLayout
							socket={game.socket}
							history={history}
							updateHistory={updateHistory}
							players={players}
							stateViewing={stateViewing}
							settings={game.settings}
							filters={game.speechFilters}
							review={game.review}
							options={game.options}
							setTyping={game.setTyping}
							agoraClient={game.agoraClient}
							localAudioTrack={game.localAudioTrack}
							setActiveVoiceChannel={game.setActiveVoiceChannel}
							muted={game.muted}
							setMuted={game.setMuted}
							deafened={game.deafened}
							setDeafened={game.setDeafened} />
					</>
				} />
		</>
	);
}
