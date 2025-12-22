const DEFAULT_IP = "192.168.1.248";

const ip = Deno.args[0] || DEFAULT_IP;

console.log(`Uploading to http://${ip}/esp/update...`);

const command = new Deno.Command("curl", {
  args: ["-F", "firmware=@./.bin/arduino.ino.bin", `http://${ip}/esp/update`],
  stdout: "inherit",
  stderr: "inherit",
});

const { code } = await command.output();

if (code === 0) {
  console.log("\nUpload complete!");
} else {
  console.error("\nUpload failed!");
  Deno.exit(1);
}
