// Web sessions use an HttpOnly cookie; never put session tokens in localStorage.
export const getToken = async (): Promise<string | null> => null;
export const setToken = async (_token: string): Promise<void> => {};
export const clearToken = async (): Promise<void> => {};
