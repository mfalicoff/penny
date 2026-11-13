import { TextField } from "@penny/ios-kit";

const w = { width: 360, padding: 16, display: "flex", flexDirection: "column" as const, gap: 10 };
export const SignIn = () => (
  <div style={w}>
    <TextField label="Email" value="max@example.com" type="email" />
    <TextField label="Password" placeholder="Your password" type="password" />
  </div>
);
export const Plain = () => <div style={w}><TextField value="Dinner with friends" /></div>;
export const Error = () => (
  <div style={w}><TextField label="Server URL" value="https://penny.example" error="Couldn't reach this server. Check the address and try again." /></div>
);
