# Destructible

[![Actions Status](https://github.com/bigeasy/destructible/workflows/Node%20CI/badge.svg)](https://github.com/bigeasy/destructible/actions)
[![codecov](https://codecov.io/gh/bigeasy/destructible/branch/master/graph/badge.svg)](https://codecov.io/gh/bigeasy/destructible)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Controlled demoltion of `async`/`await` applications.

| What          | Where                                             |
| --- | --- |
| Discussion    | https://github.com/bigeasy/destructible/issues/1  |
| Documentation | https://bigeasy.github.io/destructible            |
| Source        | https://github.com/bigeasy/destructible           |
| Issues        | https://github.com/bigeasy/destructible/issues    |
| CI            | https://travis-ci.org/bigeasy/destructible        |
| Coverage:     | https://codecov.io/gh/bigeasy/destructible        |
| License:      | MIT                                               |


```
npm install destructible
```

Destructible provides a way of managing the shutdown of asynchronous operations
in an `async`/`await based Node.js application. Any significat Node.js
application will end up running `async` functiions in parallel. Utilities for
waiting on multiple promises such as `Promise.all` provide no mechanism for
cancellation. How do you ensure that all the `Promise`s resolve and what do you
do if they do not? I mean besides `kill -9`.

The documentation is thin, but I use this library everwhere. These examples are
just notes on how to use it, but without examples it might be difficult to
understand the utility.

### `new Destructible([timeout]?, key, ...context)`

Construct a root destructible. `timeout` is the amount of time to wait for all
strands to exit, the default is one second. If there are strands that have not
returned after one second `Destructible` will scram and report an exception that
lists all the lingering stands. If you have work to do at shutdown time, you can
increase the timeout or else you can use the `destructible.working()` function
to tell `Destructible` you're making progress, but need more time.

The `key` is a string or array of strings that helps identify the `Destructible`
in the event of an exception. The `key` will be displayed in the elaborate
exeption message that Destructible generates on error.

Note that there is no concept of hard shutdown versus soft shutdown. You can
create this in your application by setting a flag, or by simply scurring through
work if `destructible.destroyed` is true. You may decide that all your open HTTP
requests should just immediately return `503`, instead of processing the
request.

**TODO** `context` is dubious, key should be enough.

### `destructible.durable(key, [Promise | async function]?)`

Either monitors a sub-strand that lasts for the duration of the lifetime of the
`Destructible`. When the sub-strand returns or raises an exception the
`Destructible` is destroyed if it is not already destroyed. All exceptions
raised by all sub-strands will be reported from the `Destructible.destructed`
property.

The `key` uniquely identifies the sub-strand among the sub-strands of this
`Destructible`. If given a `Promise`, `durable` will await the resolution of the
promise. If given an async function, `durable` will invoke the function and
await for the returned `Promise`. If called with only the `key` argument
`durable` will return child `Destructible` and await the resolution of its
`Destructible.destructed` property.

### `destructible.ephemeral(key, [Promise | async function]?)`

Either monitors a sub-strand that will not last for the duration of the lifetime
of the `Destructible`. When the sub-strand returns the `Destructible` is
destroyed if it is not already destroyed. Only if the sub-strand raises and
exception will the parent destructible be destoryed. All exceptions raised by
all sub-strands will be reported from the `Destructible.destructed` property.

The `key` uniquely identifies the sub-strand among the sub-strands of this
`Destructible`. If given a `Promise`, `durable` will await the resolution of the
promise. If given an async function, `durable` will invoke the function and
await for the returned `Promise`. If called with only the `key` argument
`durable` will return child `Destructible` and await the resolution of its
`Destructible.destructed` property.

### `destructible.attemptable(key, function)`

When you have many separate stands in your application, getting them all up and
running can present problems. You may have an error during setup and
configuration that causes to halt your setup and configuration and return early.

Wouldn't it be nice if all the exceptions for your application where funneled
through `Destructible`, even those that occurred while you where getting
`Destructible` set up?

This feature is provided because I personally enjoy test coverage, and will
gladly accept the coverage of a dependency instead of repeating the unit tests
in dependent projects. With this feature you can simply program the happy path
and trust that it will get captured.

```javascript
destructible.attemptable('main', function () {
    const server = new Server(destructible.durable('server'), function (request) {
        responder.respond(request)
    })
    const configuration = destructible.attempt('configure', async function () {
        return JSON.parse(fs.readFile(path.join(__dirname, 'config.json'), 'utf8'))
    })
    const responder = new Responder(destructible.durable('responder'), configuration)
})
await destructible.destructed
```


```javascript
destructible.ephemeral('search', async function () {
    const cursor = await strata.search('a')
}, Application.Error)
```

### `destructible.working()`

**TODO** "sub-strand"? Why? Why not just "strand"?

The `timeout` property of the `Destructible` is the amount of time to wait
before giving up on the return of a strand and
