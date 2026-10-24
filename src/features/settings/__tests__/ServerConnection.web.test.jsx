import { expect, jest, test } from "@jest/globals";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Text } from "react-native";
import { renderWeb } from "../../../../tests/web-renderer";
import { getServerUrl, saveServerConfiguration, serverStorageKey } from "../../../data/serverConnection";
import { ServerConnectionProvider } from "../../../providers/ServerConnectionProvider";
import { ServerConnection } from "../ServerConnection";

test("web never offers device server settings or changes its existing storage namespace", async () => {
  const read = jest.spyOn(AsyncStorage, "getItem");
  const write = jest.spyOn(AsyncStorage, "setItem");
  await renderWeb(<ServerConnectionProvider>
    <Text>Web session</Text>
    <ServerConnection editable />
  </ServerConnectionProvider>);
  expect(document.body.textContent).toContain("Web session");
  expect(document.body.textContent).not.toContain("Penny server");
  expect(document.body.textContent).not.toContain("Change server");
  expect(await getServerUrl()).toBe(process.env.EXPO_PUBLIC_API_URL || "");
  expect(await serverStorageKey("penny:active-account")).toBe("penny:active-account");
  await expect(saveServerConfiguration({ url: "https://other.test", version: "1.0" })).rejects.toThrow("Web uses the server hosting this app");
  expect(read).not.toHaveBeenCalled();
  expect(write).not.toHaveBeenCalled();
});
