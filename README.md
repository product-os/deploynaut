# Deployable

> A GitHub App built with [Probot](https://github.com/probot/probot) to Approve deployments via comments from maintainers.

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
docker build -t deployable .

# 2. Start container
docker run -e APP_ID=<app-id> -e PRIVATE_KEY=<pem-value> deployable
```

## Contributing

If you have suggestions for how Deployable could be improved, or want to report a bug, open an issue! We'd love all and any contributions.

For more, check out the [Contributing Guide](CONTRIBUTING.md).

## License

This project is licensed under Apache 2.0 - see the [LICENSE](LICENSE) file for
details.
