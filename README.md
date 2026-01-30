
# HttpApiProxyServer

You may use this proxy server as a cache for API calls, such that, instead of calling an API multiple times for the same query, this proxy, will will remember the API response for you (and reuse it as a response, when being feed the same request any time later).
This proxy was **developed with GraphGL in mind, but should work for other APIs as well.** If you encounter problems: Feedback about alternative use cases and feature requests are welcome.

## Using the Proxy Server

Create a HttpApiProxyServer object and configure a path to the directory, which will be used to save the cached responses.
Furthermore, minimal settings require you to input the sourceHost and sourcePort, which describe how to connect to the target API.
Finally minimal settings also require you to specify a proxyPort, which will be used to host the proxy server in localhost.

``
  const server = new HttpApiProxyServer({
    cacheDirPath: ["use-cases", "tests", "responses"],
    settings: {
      sourceHost: "official-joke-api.appspot.com",
      sourcePort: 443,
      proxyPort: 8080,
    },
  });
``

Whenever you need to start or stop the proxy, it is simple: run `await server.start()` or `await server.stop()` depending on what you need.

## Advanced Settings

The settings in the HttpApiProxyServer constructor also allow you to specify a **proxyBehavior**, which otherwise is just assumed to be the default SAVE_RESPONSES_FOR_NEW_QUERIES, which will result in the behavior, as described above.
Alternatively you can set the **proxyBehavior** to: 
- RELOAD_RESPONSES_WITH_ERRORS: Same as default, but responses will only get cached as soon as they stop containing any errors
- SAVE_RESPONSES_AND_DELETE_UNUSED: Same as default, but removes cached responses that were never used between `start()` and `stop()`.
- NO_REQUEST_FORWARDING: Just use the local response files and return errors in case there is no fitting response file.
(Use this to make sure the target API behind the proxy is not used after you setup stuff)
- FORCE_UPDATE_ALL: Use this to tell the proxy server to ignore existing responses, and save the updated versions from the target API.

## Advanced Features

Next to settings, the HttpApiProxyServer constructor also gives you an option called **overwrites**.
Overwrites is an object, which accepts response hashes as keys and allows you to define an object with the response, the proxy will provide instead of the response it may or may not have cached for that hash.

Each response you want to overwrite in such a way is represented as an object containing a status number (For the HTTP response code e.g.: 200 = OK) and a body (with the data the response will return).

Tip: If your responses are formatted as JSON (e.g. GraphGL) you may want to import a reference response (as automatically stored by the proxy server) to generate a typescript type for the response.
Such a type will not only make it easy to write the mock, but your typescript-linting will also complain to you, if the way the reference response is structured changes such that your mock can no longer be valid.

Note: Remember that proxy response may be overwritten automatically, so you should be careful, when thinking of reusing them as a mock within overwrites.


# Project History

This proxy server was created as part of a bigger typescript + react + GraphGL project at codecentric.
To test our front end against realistic data, we needed a way to use a production like API without the overhead of maintaining mocks (and even the smart [GraphGL solution](https://graphql.org/blog/mocking-with-graphql/) did not work out for us, due to the time required for maintaining mocks).
This proxy server allowed us to run tests against the real production front end, without impacting, or spamming the production API in any way.
Changes in the data provided by the production API do not break our tests until we decide to update them by updating the responses used by the proxy server.
As a result, we are able to differentiate between tests breaking due to unexpected API changes/responses vs. front end code changes.

We decided to open source our solution, to enable anyone to use it in a similar scenario, or find other creative use cases, such that we can improve this proxy server together.


# Contributing in the HttpApiProxyServer development

Here are some useful npm commands, which you can run to test your setup and changes when editing the code of the HttpApiProxyServer.

- test : run all tests once
- test:unit : run all unit tests for the proxy server once
- test:unit:watch : run all unit tests for the proxy server continuously while developing
- use-case:tests : run an example which uses the proxy server to proxy an API for a webpage running in localhost
