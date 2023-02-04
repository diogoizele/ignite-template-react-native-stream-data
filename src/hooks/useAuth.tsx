import { makeRedirectUri, revokeAsync, startAsync } from "expo-auth-session";
import React, {
  useEffect,
  createContext,
  useContext,
  useState,
  ReactNode,
} from "react";
import { generateRandom } from "expo-auth-session/build/PKCE";

import { api } from "../services/api";
import axios from "axios";
import AsyncStorage from "@react-native-async-storage/async-storage";

interface User {
  id: number;
  display_name: string;
  email: string;
  profile_image_url: string;
}

interface AuthContextData {
  user: User;
  isLoggingOut: boolean;
  isLoggingIn: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

interface AuthProviderData {
  children: ReactNode;
}

interface StartAsyncResponse {
  authentication: null;
  errorCode: null;
  params: {
    access_token: string;
    scope: string;
    state: string;
    token_type: string;
  };
  type: string;
  url: string;
}

const AuthContext = createContext({} as AuthContextData);

const twitchEndpoints = {
  authorization: "https://id.twitch.tv/oauth2/authorize",
  revocation: "https://id.twitch.tv/oauth2/revoke",
};

const KEYS = {
  TOKEN: "@twitch:token",
  USER: "@twitch:user",
};

function AuthProvider({ children }: AuthProviderData) {
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [user, setUser] = useState({} as User);
  const [userToken, setUserToken] = useState("");

  // get CLIENT_ID from environment variables
  const { CLIENT_ID } = process.env;

  async function signIn() {
    try {
      // set isLoggingIn to true
      setIsLoggingIn(true);

      // REDIRECT_URI - create OAuth redirect URI using makeRedirectUri() with "useProxy" option set to true
      const REDIRECT_URI = makeRedirectUri({
        useProxy: true,
      });

      // RESPONSE_TYPE - set to "token"
      const RESPONSE_TYPE = "token";

      // SCOPE - create a space-separated list of the following scopes: "openid", "user:read:email" and "user:read:follows"
      const SCOPE = encodeURI(
        ["openid", "user:read:email", "user:read:follows"].join(" ")
      );

      // FORCE_VERIFY - set to true
      const FORCE_VERIFY = true;

      // STATE - generate random 30-length string using generateRandom() with "size" set to 30
      const STATE = generateRandom(30);

      // assemble authUrl with twitchEndpoint authorization, client_id,
      // redirect_uri, response_type, scope, force_verify and state
      const authUrl = `${twitchEndpoints.authorization}?client_id=${CLIENT_ID}&redirect_uri=${REDIRECT_URI}&response_type=${RESPONSE_TYPE}&scope=${SCOPE}&force_verify=${FORCE_VERIFY}&state=${STATE}`;

      // call startAsync with authUrl

      const response = (await startAsync({
        authUrl,
      })) as StartAsyncResponse;

      // verify if startAsync response.type equals "success" and response.params.error differs from "access_denied"
      // if true, do the following:
      if (response.type === "success") {
        // verify if startAsync response.params.state differs from STATE
        // if true, do the following:
        // throw an error with message "Invalid state value"

        // console.log("state:", String(STATE) != String(response.params.state));
        // if (STATE !== response.params.state) {
        //   throw new Error("Invalid state value");
        // }

        // add access_token to request's authorization header
        api.defaults.headers.common[
          "Authorization"
        ] = `Bearer ${response.params.access_token}`;

        // call Twitch API's users route

        try {
          const { data } = await api.get("/users", {
            headers: {
              "Client-Id": CLIENT_ID,
              Authorization: `Bearer ${response.params.access_token}`,
            },
          });

          // set user state with response from Twitch API's route "/users"
          setUser(data.data[0]);

          // set userToken state with response's access_token from startAsync
          setUserToken(response.params.access_token);

          await AsyncStorage.setItem(KEYS.TOKEN, response.params.access_token);
          await AsyncStorage.setItem(KEYS.USER, JSON.stringify(data.data[0]));
        } catch (e) {
          throw new Error(e as any);
        }
      } else {
        console.log("error");
        // throw an error with message "Access denied"
        throw new Error("Access denied");
      }
    } catch (error) {
      // throw an error

      throw new Error(error as any);
    } finally {
      // set isLoggingIn to false
      setIsLoggingIn(false);
    }
  }

  async function signOut() {
    try {
      // set isLoggingOut to true
      setIsLoggingOut(true);

      // call revokeAsync with access_token, client_id and twitchEndpoint revocation
      await revokeAsync(
        {
          token: userToken,
          clientId: CLIENT_ID,
        },
        {
          revocationEndpoint: twitchEndpoints.revocation,
        }
      );
    } catch (error) {
    } finally {
      // set user state to an empty User object
      setUser({} as User);

      // set userToken state to an empty string
      setUserToken("");

      // remove "access_token" from request's authorization header
      // set isLoggingOut to false
      delete api.defaults.headers.common["Authorization"];
      await AsyncStorage.removeItem(KEYS.TOKEN);
      await AsyncStorage.removeItem(KEYS.USER);
      setIsLoggingOut(false);
    }
  }

  useEffect(() => {
    // add client_id to request's "Client-Id" header
    api.defaults.headers.common["Client-Id"] = CLIENT_ID;

    // add access_token to request's authorization header
    // if userToken state is not an empty string

    if (userToken) {
      api.defaults.headers.common["Authorization"] = `Bearer ${userToken}`;
    }
  }, [userToken]);

  useEffect(() => {
    //https://dev.twitch.tv/docs/authentication/validate-tokens/
    (async () => {
      const storagedToken = await AsyncStorage.getItem(KEYS.TOKEN);
      const storagedUser = await AsyncStorage.getItem(KEYS.USER);

      const userLogged = storagedUser ? JSON.parse(storagedUser) : null;

      if (storagedToken) {
        setIsLoggingIn(true);
        try {
          const { data } = await axios.get(
            "https://id.twitch.tv/oauth2/validate",
            {
              headers: {
                Authorization: `OAuth ${storagedToken}`,
              },
            }
          );

          if (data.login === userLogged?.login) {
            setUserToken(storagedToken);
            setUser(userLogged);
          }
        } catch (error: any) {
          setUserToken("");
          setUser({} as User);

          await AsyncStorage.removeItem(KEYS.TOKEN);
          await AsyncStorage.removeItem(KEYS.USER);
        } finally {
          setIsLoggingIn(false);
        }
      }
    })();
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, isLoggingOut, isLoggingIn, signIn, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}

function useAuth() {
  const context = useContext(AuthContext);

  return context;
}

export { AuthProvider, useAuth };
