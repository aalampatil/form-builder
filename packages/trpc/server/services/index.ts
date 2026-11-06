import UserService from "@repo/services/user";
import AuthService from "@repo/services/auth";

// services will be initialized here and exported for use in the application

export const userService = new UserService();
export const authService = new AuthService();
