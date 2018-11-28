require('proof')(1, prove)

// The unusual case of constructing children but not be able to spawn the in
// serial. The constructors build objects that depend on each other. The first
// child you build waits on a promise that will deliver the second child you
// build. If you run in serial you will deadlock because you will be waiting for
// the constructor of the first child to complete before you can begin to build
// the second child, but the constructor of the first child is waiting on the
// second child to be constructed.
//
// Assuming we don't know about these dependencies ourselves, because if we did
// we'd just build things in the right order, we need to do program starts in
// parallel, catch an error from the parallel starts, and countdown the starts
// so that we know when we can return.
//
// I'm struggling with this one because it seems like you could create service
// monitor and gather up your errors in the service monitor, if any. The
// service monitor can terminate. The service destructible is used to create
// callacks to give to the constructors. The constructors are constructed using
// the applications destructible.
//
// First issue is that we're now going to timeout on the creation if they don't
// construct in time. Some of them will return destroying our ephemeral
// constructor. Any that don't are going to cause this service to be marked as
// hung. What's wrong with this exactly?
//
// You expect to be able to use the sub-destructible as a way to gather the
// constructed objects because you're able to do that from the serial
// construction.


// With the above in mind I went off to work on Olio again and I'm somewhat more
// comfortable with the parallel result. Parallel is ugly and it is going to
// rarely be used in applications. Olio is going to encapsulate heterogeneous
// tasks and divide them by process. Normal applications are going to have
// heterogeneous tasks running next to each other in stacks, but those
// applications are going to have knowledge as to the dependencies and will be
// able to construct them.
//
// In fact, it appears that the inversion of control addition was an effect of
// the plague of this parallel startup in Olio. Never used. Didn't really answer
// the problem. If it did raise itself again, I'd pass a Cubbyhole to the
// constructors and have them share their startup information that way.
//
// What I saw from reworking Olio was that both the test and program examples
// are examples show that everything starts with a call to an anonymous Cadence.
// Adding an anonymous Cadence, which I did without thinking, just by typing,
// and now it appears to be like the test and program examples. The anonymous
// cadence accepts the error callback, but it has the logic to do the countdown
// and to gather the results of the constructor and place them in a bouquet for
// our dear user to inspect and use.

//
function prove (okay) {
    okay(require('..'), 'require')
}
