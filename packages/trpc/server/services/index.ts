import UserService from "@repo/services/user";
import AuthService from "@repo/services/auth";
import FormsService from "@repo/services/forms";
import ResponsesService from "@repo/services/responses";

export const userService = new UserService();
export const authService = new AuthService();
export const formsService = new FormsService();
export const responsesService = new ResponsesService();
