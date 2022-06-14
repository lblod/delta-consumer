export type Resource = {
    value: string,
    type: "uri"
};

export type Literal = {
    value: string,
    type: "literal",
    datatype?: string,
    lang?: string
};

export type Quad = {
    subject: Resource,
    predicate: Resource,
    object: Literal | Resource,
    graph: Resource
};

export type ChangeSet = {
    inserts: Quad[],
    deletes: Quad[]
};

export type QuadDispatcher = (quad:Quad) => Quad[];
