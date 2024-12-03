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

## Contributing

If you have suggestions for how deploynaut could be improved, or want to report a bug, open an issue! We'd love all and any contributions.

For more, check out the [Contributing Guide](CONTRIBUTING.md).

## License

This project is licensed under Apache 2.0 - see the [LICENSE](LICENSE) file for
details.
