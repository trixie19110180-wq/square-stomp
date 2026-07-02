# Deploy Square Stomp For Free

## 1. Create a GitHub account

1. Open `https://github.com`.
2. Click `Sign up`.
3. Enter your email, password, and a username.
4. Verify your email.
5. Skip optional setup questions.

## 2. Create an empty GitHub repository

1. Click the `+` button near the top right.
2. Click `New repository`.
3. Repository name: `square-stomp`
4. Visibility: `Public`
5. Do not add a README, gitignore, or license.
6. Click `Create repository`.

## 3. Upload the game files

Open this folder on your Mac:

```text
/Users/jinheean/Documents/multiplayer-square-stomp
```

Upload these items:

```text
.gitignore
DEPLOY.md
README.md
package.json
pnpm-lock.yaml
server.js
public
```

Do not upload:

```text
node_modules
```

On GitHub, the normal upload path is:

1. Go to your repository page.
2. Click the `Code` tab.
3. Click `Add file`.
4. Click `Upload files`.
5. Drag the items listed above into the browser.
6. Click `Commit changes`.

If you cannot see `Add file`:

1. Make sure the URL looks like `https://github.com/YOUR_USERNAME/square-stomp`.
2. Make sure you are logged in to the account that owns the repository.
3. Make the browser window wider. GitHub hides some buttons when the window is narrow.
4. Click the `Code` tab near the top of the repository.
5. If the repo is empty, look for the text link named `uploading an existing file`.
6. If you still cannot find it, drag the files directly onto the repository page. GitHub supports dragging files or folders into the browser.

## 4. Deploy on Render

1. Open `https://render.com`.
2. Sign up with your GitHub account.
3. Click `New`.
4. Click `Web Service`.
5. Select your `square-stomp` GitHub repository.
6. Use these settings:

```text
Name: square-stomp
Runtime: Node
Build Command: corepack enable && pnpm install --frozen-lockfile
Start Command: pnpm start
Plan: Free
```

7. Add these environment variables if you want reserved-name admin powers:

```text
ADMIN_PASSCODE_TEXT=your-admin-password
ADMIN_PASSCODE_CODE=your-6-digit-code
```

8. Click `Deploy Web Service`.
9. Wait for Render to finish.
10. Open the Render URL it gives you.

Free Render services can sleep when nobody is playing, so the first visit may be slow.
