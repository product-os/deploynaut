# deploynaut

A GitHub App built with [Probot](https://github.com/probot/probot) to approve deployments via reviews from maintainers

## Setup

```sh
# Install dependencies
npm install

# Run the bot
npm start
```

## Docker

```sh
# 1. Build container
docker build -t deploynaut .

# 2. Start container
docker run -e APP_ID=<app-id> -e PRIVATE_KEY=<pem-value> deploynaut
```

## Environment Variables

- `BYPASS_ACTORS`: A comma-separated list of GitHub user IDs to bypass the approval process.

  For users, you can find the ID by visiting `https://api.github.com/users/<username>`
  For apps, you can find the ID by visiting `https://api.github.com/users/<app-name>%5Bbot%5D`

  ```shell
  # https://api.github.com/users/flowzone-app%5Bbot%5D
  # https://api.github.com/users/balena-renovate%5Bbot%5D
  BYPASS_ACTORS=124931076,133977723
  ```

- `APP_ID`: The ID of the GitHub App.
- `PRIVATE_KEY`: The private key of the GitHub App.
- `WEBHOOK_SECRET`: The secret used to verify the authenticity of the webhook.
- `WEBHOOK_PROXY_URL`: The URL to proxy the webhook to.
- `LOG_LEVEL`: Defaults to `info`.

## Contributing

If you have suggestions for how deploynaut could be improved, or want to report a bug, open an issue! We'd love all and any contributions.

For more, check out the [Contributing Guide](CONTRIBUTING.md).

## License

This project is licensed under Apache 2.0 - see the [LICENSE](LICENSE) file for
details.
