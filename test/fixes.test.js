// Run from the MagicMirror root (needs its moment):
// node --test modules/MMM-NetworkScanner/test/fixes.test.js
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const moment = require("moment");

const moduleDirectory = path.resolve(__dirname, "..");

function loadHelper() {
	const helperModule = { exports: {} };
	const arpScans = [];
	vm.runInNewContext(fs.readFileSync(path.join(moduleDirectory, "node_helper.js"), "utf8"), {
		module: helperModule,
		require (name) {
			if (name === "node_helper") return { create: (definition) => definition };
			if (name === "sudo") return (args) => {
				arpScans.push(args);
				return { stdout: { on () {} }, stderr: { on () {} }, on () {} };
			};
			if (name === "ping") return { sys: { probe () {} } };
			throw new Error(`Unexpected require: ${name}`);
		},
		console: { log () {} }
	});
	const helper = Object.assign(helperModule.exports, { name: "MMM-NetworkScanner", sendSocketNotification () {} });
	return { helper, arpScans };
}

function loadFrontend(config) {
	let definition;
	vm.runInNewContext(fs.readFileSync(path.join(moduleDirectory, "MMM-NetworkScanner.js"), "utf8"), {
		Module: { register (name, value) { definition = value; } },
		Log: { info () {} },
		moment,
		setInterval () {}
	});
	const frontend = Object.assign(Object.create(definition), {
		name: "MMM-NetworkScanner",
		config: { ...definition.defaults, ...config },
		updateDom () {},
		sendNotification () {}
	});
	frontend.validateDevices();
	return frontend;
}

test("helper does not crash when a scan is requested before the config", () => {
	const { helper, arpScans } = loadHelper();
	assert.doesNotThrow(() => helper.socketNotificationReceived("SCAN_NETWORK"));
	assert.equal(arpScans.length, 0);
});

test("helper uses the config sent with the scan request", () => {
	const { helper, arpScans } = loadHelper();
	helper.socketNotificationReceived("SCAN_NETWORK", { network: "192.168.0.0/24", devices: [] });
	assert.deepEqual(arpScans.map((args) => args.join(" ")), ["arp-scan -q 192.168.0.0/24"]);
});

test("frontend sends its config with every scan request", () => {
	const frontend = loadFrontend({ updateInterval: 60 });
	const sent = [];
	frontend.sendSocketNotification = (notification, payload) => sent.push({ notification, payload });
	frontend.scanNetwork();
	assert.equal(sent[0].notification, "SCAN_NETWORK");
	assert.equal(sent[0].payload, frontend.config);
});

test("frontend shows unknown devices together with offline devices", () => {
	const frontend = loadFrontend({
		showOffline: true,
		showUnknown: true,
		devices: [{ macAddress: "AA:BB:CC:11:22:33", name: "Phone" }]
	});
	frontend.socketNotificationReceived("MAC_ADDRESSES", [
		{ macAddress: "DD:EE:FF:44:55:66", name: "DD:EE:FF:44:55:66", icon: "question", type: "Unknown" }
	]);
	const names = frontend.networkDevices.map((device) => device.name);
	assert.ok(names.includes("Phone"));
	assert.ok(names.includes("DD:EE:FF:44:55:66"));
});
