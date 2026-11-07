import { GetAuthenticationMethodOutputSchema } from "./model";

class UserService {
  public async getAuthenticationMethods(): Promise<
    ReadonlyArray<GetAuthenticationMethodOutputSchema>
  > {
    const supportedAuthenticationProviders: GetAuthenticationMethodOutputSchema[] = [];

    // Legacy discovery is no longer exposed. Configure providers on Clerk.

    return supportedAuthenticationProviders;
  }
}

export default UserService;
