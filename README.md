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

Monitors a strand that lasts for the duration of the lifetime of the
`Destructible`. When the strand returns or raises an exception the
`Destructible` is destroyed if it is not already destroyed, triggering all
destructors and setting a scram timer. Any exception raised by the strand will
be reported from an exception thrown awaiting the `Destructible.destructed`
property.

If given a `Promise` or function `durable` will return a `Promise` that resolves
to the value of the `Promise` or function. If the `Promise` rejects or the
function throws an exception, `durable` will reject with a `Destructible.Error`
with a `code` property set to `"destroyed"`. The actual rejected or thrown
exception is obtained through the `Destructible.destructed` property.

**TODO** `key` becomes `context`.

The `key` identifies the strand among the strands of this `Destructible`. If
given a `Promise`, `durable` will await the resolution of the promise. If given
an async function, `durable` will invoke the function and await for the returned
`Promise`. If called with only the `key` argument `durable` will return child
`Destructible` and await the resolution of its `Destructible.destructed`
property.

### `destructible.ephemeral(key, [Promise | async function]?)`

Monitors a strand that will not last for the duration of the lifetime of the
`Destructible`. Only if the sub-strand raises and exception will the parent
destructible be destroyed. Any exception raised by the strands will be reported
from the `Destructible.destructed` property.

If given a `Promise` or function `durable` will return a `Promise` that resolves
to the value of the `Promise` or function. If the `Promise` rejects or the
function throws an exception, `durable` will reject with a `Destructible.Error`
with a `code` property set to `"destroyed"`. The actual rejected or thrown
exception is obtained through the `Destructible.destructed` property.

If called without a `Promise` or function, `ephemeral` returns an instance of
`Destructible`. The parent will await the `Destructible.destructed` method of
the this `Destructable`. When the parent is destroyed, the child `Destructible`
is also destroyed. If the child `Destructible` does not complete before before
the scram timeout, the exception rejected by `Destructible.destructed` will
include the specific `Promise`s or functions within the child that failed to
resolve or reject.

**TODO** `key` becomes `context` and this gets rewritten.

The `key` uniquely identifies the sub-strand among the sub-strands of this
`Destructible`. If given a `Promise`, `durable` will await the resolution of the
promise. If given an async function, `durable` will invoke the function and
await for the returned `Promise`. If called with only the `key` argument
`durable` will return child `Destructible` and await the resolution of its
`Destructible.destructed` property.

### `handle = destructible.destruct(function)`

Registers a destructor function that is called when the `Destructible` is
destroyed. The `destructor` function must be synchronous and should not be an
`async` function nor return a `Promise`.

If you need to perform asynchronous operations during shutdown you can start an
ephemeral strand by calling the `Destructible.ephemeral` on the destructing
`Destructible`. You are allowed to call `ephemeral` from within a destructor
even though the `Destructible` if officially destroyed. It will be monitored
like any other strand with exceptions reported through the
`Destructible.destructed` method and scramed if it fails to complete or make
progress within the timeout.

### `Destructible.rescue(function)`

Once your `Destructible` tree is build all of your exceptions will be reported
by a root `Destructible.destructed`, but until then you have exceptions that may
occur preventing you from getting your `Destructible` tree build. It creates a
situation where you need to create `try/finally` blocks that will finally
destroy the root `destructible` when ideally the exit of a durable or wiring
`Destructible.destroy()` to `SIGTERM` should bring down the tree.

Furthermore, if your application throws the configuration file error, what about
any exceptions that are in `Destructible.destructed`? Do you log one throw the
other out? Log both? `Destructible.destructed` is supposed to be your tree of
all exceptions and now you have an exception that snuck out.

`Destructible.rescue()` provides an idiom for setup. If you need to perform
asynchronous function calls to get setup materials (we're talking configuration
files here) you can perform then in an ephemeral strand. If there is an
exception it will be reported through the exception rejected by
`Destructible.destructed`. The immediate exception will be `Destructible.Error`
with a `.code = "destroyed"`. (You know, so much easier to document if you would
just create a `Destructible.Destroyed` exception, really just, please.)
`Destructible.rescue()` will swallow that exception on the assumtion that you'll
be awaiting on `Destructible.destructed` shorly after `Destructible.rescue()`
returns.

```javascript
const destructible = new Destructible('main')
process.on('SIGTERM', destructible.destroy.bind(destructible))
await Destructible.rescue(async function () {
    const server = new Server(destructible.durable('server'), function (request) {
        responder.respond(request)
    })
    const configuration = await destructible.ephemeral('configure', async function () {
        return JSON.parse(fs.readFile(path.join(__dirname, 'config.json'), 'utf8'))
    })
    const responder = new Responder(destructible.durable('responder'), configuration)
})
await destructible.destructed
```

### `destructible.working()`

The `timeout` property of the `Destructible` is the amount of time to wait
before giving up on the return of a strand and

### `destructible.operational()`

Throws a `Destructible.Destroyed` exception if the destructible has been
destroyed. You can call this from your application if a method depends on a
`Destructible` but does not always call `ephemeral` or `durable` directly to
create a new strand and thereby raise the `Destructible.Destroyed` exception.

### `destructible.clear(handle)`

Clear a destructor so that it will not be run at destruction.

### `DestructorSet = destructible.destructor()`

Returns an object used to build a collection of destructors that can be cleared
all at once. Not going to document this because its dubious and I forgot why I
made it or where I use it. Couldn't `destructible.clear()` just take an
iterable so you could create an array or Set? Oh, I like that. Let's do that
instead.
