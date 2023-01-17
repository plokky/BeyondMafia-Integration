import React, { useState, useEffect, useContext } from "react";
import { Redirect } from "react-router-dom";
import axios from "axios";

import Host from "./Host";
import { useForm } from "../../../components/Form";
import { useErrorAlert } from "../../../components/Alerts";
import { SiteInfoContext } from "../../../Contexts";
import { Lobbies } from "../../../Constants";

import "../../../css/host.css"

export default function HostCanvasGame() {
    const gameType = "Canvas Game";
    const [selSetup, _setSelSetup] = useState({});
    const [redirect, setRedirect] = useState(false);
    const siteInfo = useContext(SiteInfoContext);
    const errorAlert = useErrorAlert();
    const [formFields, updateFormFields] = useForm([
        {
            label: "Setup",
            ref: "setup",
            type: "text",
            disabled: true,
        },
        {
            label: "Lobby",
            ref: "lobby",
            type: "select",
            value: localStorage.getItem("lobby") || "Games",
            options: Lobbies.map(lobby => ({ label: lobby, value: lobby })),
        },
        {
            label: "Private",
            ref: "private",
            type: "boolean"
        },
        {
            label: "Allow Guests",
            ref: "guests",
            type: "boolean"
        },
        {
            label: "Spectating",
            ref: "spectating",
            type: "boolean"
        },
        // {
        //     label: "Voice Chat",
        //     ref: "voiceChat",
        //     type: "boolean"
        // },
        {
            label: "Scheduled",
            ref: "scheduled",
            type: "boolean"
        },
        {
            label: "Ready Check",
            ref: "readyCheck",
            type: "boolean"
        },
        {
            label: "Start Date",
            ref: "startDate",
            type: "datetime-local",
            showIf: "scheduled",
            value: Date.now() + (6 * 60 * 1000),
            min: Date.now() + (6 * 60 * 1000),
            max: Date.now() + (4 * 7 * 24 * 60 * 60 * 1000)
        },
        {
            label: "Turn Length (minutes)",
            ref: "initTurnLength",
            type: "number",
            value: 3,
            min: 1,
            max: 5
        },
        {
            label: "Players",
            ref: "playerCount",
            type: "number",
            value: 1,
            min: 1,
            max: 1
        },
    ]);

    useEffect(() => {
        document.title = "Host Games | BeyondMafia";
    }, []);

    function onHostGame() {
        var scheduled = formFields[6].value;

        if (selSetup.id)
            axios.post("/game/host", {
                gameType: gameType,
                setup: selSetup.id,
                lobby: getFormFieldValue("lobby"),
                private: getFormFieldValue("private"),
                guests: getFormFieldValue("guests"),
                ranked: false,
                spectating: getFormFieldValue("spectating"),
                // voiceChat: getFormFieldValue("voiceChat"),
                scheduled: scheduled && (new Date(getFormFieldValue("startDate"))).getTime(),
                readyCheck: getFormFieldValue("readyCheck"),
                playerCount: getFormFieldValue("playerCount"),
                stateLengths: {
                    "Turn": getFormFieldValue("initTurnLength"),
                }
            })
                .then(res => {
                    if (scheduled) {
                        siteInfo.showAlert(`Game scheduled.`, "success");
                        setRedirect("/");
                    }
                    else
                        setRedirect(`/game/${res.data}`);
                })
                .catch(errorAlert);
        else
            errorAlert("You must choose a setup");
    }

    function setSelSetup(setupInfo) {
        const playerCountRef = getFormFieldData("playerCount");

        playerCountRef.min = setupInfo.minPlayers;
        playerCountRef.max = setupInfo.maxPlayers;
        playerCountRef.value = setupInfo.minPlayers;

        _setSelSetup(setupInfo);
    }

    function getFormFieldValue(ref) {
        for (let field of formFields)
            if (field.ref == ref)
                return field.value;
    }

    function getFormFieldData(ref) {
        for (let field of formFields)
            if (field.ref == ref)
                return field;
    }

    if (redirect)
        return <Redirect to={redirect} />

    return (
        <Host
            gameType={gameType}
            selSetup={selSetup}
            setSelSetup={setSelSetup}
            formFields={formFields}
            updateFormFields={updateFormFields}
            onHostGame={onHostGame} />
    );
}
