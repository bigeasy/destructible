// We're going to use our unit test framework so we can run within an `async`
// function that will catch and report errors.

//
require('proof')(3, async okay => {
    // In your program this would be
    //
    // ```javascript
    // const Destructible = require('destructible')
    // ```
    //
    // But we'll be running this as a unit test as part of CI/CD to ensure that
    // this readme doens't get out of date.

    //
    const Destructible = require('..')

    // We'll be using these anoymous blocks so we can show declarations that
    // should use `const` each time we illustrate a point. Without them we'd
    // have have to use varaiable names like `destructible2`, `destructible3`.

    //
    {
        const destructible = new Destructible('example')
        await destructible.destroy().rejected
    }

    // If you're wondering what just happened, we created an instance of
    // `Destructible`, immediately destroyed and then waited for the funnel
    // promise to resolve or reject. Let's look at that again and look at a few
    // of the properties of `Destructible` while we're at it.
    //
    // When you create a destructible, you give it an identifier. This will
    // become a property of the `Destructible`.
    //
    // The `destroy()` method destroys the `Destructible` and then returns the
    // `Destructible` so you can perform the common action of destroying and
    // awaiting the result as a one-liner.

    //
    {
        // Construct a destructible with an `id` of `'example'`.
        const destructible = new Destructible('example')

        // Look at some of the properties of the `Destructible`.
        okay(destructible.id, 'example', 'destructible id has been set')
        okay(!destructible.destroyed, 'destructible has not been destroyed')

        // Destroy the `Destructible` and await its funnel `Promise`.
        await destructible.destroy().rejected

        // The destructible is now `destroyed`.
        okay(destructible.destroyed, 'destructible has been destroyed')
    }

    // Let's do some work with a `Destructible`.

    //
    {
        const destructible = new Destructible('example')

        destructible.durable('loop', async () => {
            while (!destructible.destroyed) {
                console.log('loop')
                await new Promise(resolve => setTimeout(resolve, 50))
            }
        })

        await new Promise(resolve => setTimeout(resolve, 250))

        await destructible.destroy().rejected
    }
//

//
})
